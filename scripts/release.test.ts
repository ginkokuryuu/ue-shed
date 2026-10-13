import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { delimiter, join, resolve } from "node:path";
import {
	assertReusableCheck,
	assertPublicationConfirmation,
	parseReleaseArguments,
	publicationConfirmationPhrase,
	releaseEnvironment,
	runRelease
} from "./release.ts";

test("release discovers rustup through a normalized PATH without mutating the shell", (context) => {
	const directory = mkdtempSync(join(tmpdir(), "ue-shed-release-"));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	const cargoHome = join(directory, "cargo");
	const cargoBin = join(cargoHome, "bin");
	mkdirSync(cargoBin, { recursive: true });
	const executable =
		process.platform === "win32"
			? "release-environment-probe.exe"
			: "release-environment-probe";
	const executablePath = join(cargoBin, executable);
	if (process.platform === "win32") {
		copyFileSync(process.execPath, executablePath);
	} else {
		writeFileSync(executablePath, "#!/bin/sh\nexit 0\n");
		chmodSync(executablePath, 0o755);
	}
	const environment = { Path: "existing-tools", CARGO_HOME: cargoHome };
	const result = releaseEnvironment(environment, directory);
	assert.deepEqual(
		Object.keys(result).filter((key) => key.toLowerCase() === "path"),
		["PATH"]
	);
	assert.ok(result.PATH?.split(delimiter).includes("existing-tools"));
	assert.ok(result.PATH?.split(delimiter).includes(cargoBin));
	assert.equal(spawnSync(executable, [], { env: result }).status, 0);
	assert.equal(result.CARGO_TARGET_DIR, resolve(import.meta.dirname, "..", "target"));
	assert.deepEqual(environment, { Path: "existing-tools", CARGO_HOME: cargoHome });
});

test("release respects custom Cargo installation and build output", () => {
	const cargoHome = resolve("custom-cargo");
	const target = resolve("shared-target");
	const result = releaseEnvironment({ CARGO_HOME: cargoHome, CARGO_TARGET_DIR: target });
	assert.ok(result.PATH?.split(delimiter).includes(join(cargoHome, "bin")));
	assert.equal(result.CARGO_TARGET_DIR, target);
});

test("requires the exact versioned publication phrase", () => {
	assert.equal(publicationConfirmationPhrase("0.5.2"), "publish 0.5.2");
	assert.doesNotThrow(() => assertPublicationConfirmation("publish 0.5.2", "0.5.2"));
	assert.throws(
		() => assertPublicationConfirmation("", "0.5.2"),
		/expected the exact phrase "publish 0\.5\.2"/
	);
	assert.throws(
		() => assertPublicationConfirmation("publish 0.5.1", "0.5.2"),
		/expected the exact phrase "publish 0\.5\.2"/
	);
});

test("waits for confirmation after checks and before publication", async () => {
	const events: string[] = [];
	await runRelease({
		validateSource: () => {
			events.push("validate-source");
			return "a".repeat(40);
		},
		check: () => events.push("check"),
		confirm: async () => {
			events.push("confirm-start");
			await Promise.resolve();
			events.push("confirm-end");
		},
		publish: () => events.push("publish")
	});
	assert.deepEqual(events, [
		"validate-source",
		"check",
		"confirm-start",
		"confirm-end",
		"validate-source",
		"publish"
	]);
});

test("does not check or publish when the release source is dirty", async () => {
	const events: string[] = [];
	await assert.rejects(
		() =>
			runRelease({
				validateSource: () => {
					events.push("validate-source");
					throw new Error("release source is dirty");
				},
				check: () => events.push("check"),
				confirm: async () => {
					events.push("confirm");
				},
				publish: () => events.push("publish")
			}),
		/release source is dirty/
	);
	assert.deepEqual(events, ["validate-source"]);
});

test("does not publish when the source changes during release checks", async () => {
	const events: string[] = [];
	let validationCount = 0;
	await assert.rejects(
		() =>
			runRelease({
				validateSource: () => {
					validationCount += 1;
					events.push("validate-source");
					return validationCount === 1 ? "a".repeat(40) : "b".repeat(40);
				},
				check: () => events.push("check"),
				confirm: async () => {
					events.push("confirm");
				},
				publish: () => events.push("publish")
			}),
		/Release source changed from a{40} to b{40} during validation\./
	);
	assert.deepEqual(events, ["validate-source", "check", "confirm", "validate-source"]);
});

test("does not request confirmation or publish when checks fail", async () => {
	const events: string[] = [];
	await assert.rejects(
		() =>
			runRelease({
				validateSource: () => {
					events.push("validate-source");
					return "a".repeat(40);
				},
				check: () => {
					events.push("check");
					throw new Error("checks failed");
				},
				confirm: async () => {
					events.push("confirm");
				},
				publish: () => events.push("publish")
			}),
		/checks failed/
	);
	assert.deepEqual(events, ["validate-source", "check"]);
});

test("does not publish when confirmation is blank or interrupted", async () => {
	const events: string[] = [];
	await assert.rejects(
		() =>
			runRelease({
				validateSource: () => {
					events.push("validate-source");
					return "a".repeat(40);
				},
				check: () => events.push("check"),
				confirm: async () => {
					events.push("confirm");
					assertPublicationConfirmation("", "0.5.2");
				},
				publish: () => events.push("publish")
			}),
		/expected the exact phrase "publish 0\.5\.2"/
	);
	assert.deepEqual(events, ["validate-source", "check", "confirm"]);
});

const releaseNotes = "docs/releases/0.5.2.md";

function reuse(commit: string, changes: readonly string[] = []) {
	return { commit, releaseNotes, changesSince: () => changes };
}

test("skips the gate for the exact checked release commit", async () => {
	const events: string[] = [];
	await runRelease({
		validateSource: () => {
			events.push("validate-source");
			return "a".repeat(40);
		},
		check: () => events.push("check"),
		confirm: async () => {
			events.push("confirm");
		},
		publish: () => events.push("publish"),
		reuseCheck: reuse("a".repeat(40))
	});
	assert.deepEqual(events, ["validate-source", "confirm", "validate-source", "publish"]);
});

test("reuses a check when only the release notes changed since it", () => {
	assert.doesNotThrow(() =>
		assertReusableCheck(reuse("b".repeat(40), [releaseNotes]), "a".repeat(40))
	);
});

test("does not confirm or publish when the release changed beyond its notes", async () => {
	const events: string[] = [];
	await assert.rejects(
		() =>
			runRelease({
				validateSource: () => {
					events.push("validate-source");
					return "a".repeat(40);
				},
				check: () => events.push("check"),
				confirm: async () => {
					events.push("confirm");
				},
				publish: () => events.push("publish"),
				reuseCheck: reuse("b".repeat(40), [releaseNotes, "scripts/release.ts"])
			}),
		/--checked b{40} differs from release HEAD a{40} beyond docs\/releases\/0\.5\.2\.md \(scripts\/release\.ts\); rerun pnpm check\./
	);
	assert.deepEqual(events, ["validate-source"]);
});

test("does not reuse a check from a commit outside the release history", () => {
	assert.throws(
		() =>
			assertReusableCheck(
				{
					commit: "b".repeat(40),
					releaseNotes,
					changesSince: () => {
						throw new Error("not an ancestor");
					}
				},
				"a".repeat(40)
			),
		/not an ancestor/
	);
});

test("requires a full lowercase commit for --checked", () => {
	assert.throws(() => assertReusableCheck(reuse("abc1234"), "a".repeat(40)), /full 40-character/);
	assert.throws(
		() => assertReusableCheck(reuse("A".repeat(40)), "a".repeat(40)),
		/full 40-character/
	);
});

test("parses --checked and rejects unknown release arguments", () => {
	assert.deepEqual(parseReleaseArguments([]), { checkedCommit: undefined });
	assert.deepEqual(parseReleaseArguments(["--checked", "a".repeat(40)]), {
		checkedCommit: "a".repeat(40)
	});
	assert.throws(() => parseReleaseArguments(["--skip-check"]));
});
