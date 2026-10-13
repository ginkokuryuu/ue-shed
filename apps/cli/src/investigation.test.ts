import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { useSavedFixtureProject } from "../../../fixtures/unreal-project/saved-project.test-support.js";
import { runCli } from "./command.js";
import { CliRuntime } from "./cli-runtime.js";

// The repository lane deliberately runs without the native reader. The UAsset IO lane
// supplies it and runs both real fixture replays below.
it.skipIf(!process.env.UE_SHED_UASSET_EXECUTABLE).each(["game_text", "texture_audit"])(
	"replays a %s preset through the CLI and native reader",
	async (kind) => {
		const root = await mkdtemp(join(tmpdir(), "ue-shed-cli-investigation-"));
		const project = resolve("fixtures/unreal-project");
		let output = "";
		const runtime = Layer.succeed(
			CliRuntime,
			CliRuntime.of({
				print: (value) =>
					Effect.sync(() => {
						output += value;
					}),
				printError: (value) => Effect.die(value),
				setExitCode: (code) => Effect.die(`Unexpected exit ${code}`)
			})
		);
		try {
			const rules = JSON.parse(
				await readFile(
					join(
						project,
						"FixtureSource",
						kind === "game_text"
							? "Text/quality-rules.json"
							: "Audits/texture-rules.json"
					),
					"utf8"
				)
			);
			const preset = {
				schemaVersion: 1,
				kind,
				sort: kind === "game_text" ? "domain_order" : "object_path",
				query:
					kind === "game_text"
						? {
								mode: "quality",
								query: "",
								capability: "all",
								lens: "all",
								qualityFilter: "character_budget"
							}
						: { findingsOnly: true, query: "" },
				rules
			};
			const presetPath = join(root, "preset.json");
			const outputPath = join(root, "export.csv");
			await writeFile(presetPath, JSON.stringify(preset));
			const args = ["investigations", "run", project, "--preset", presetPath];
			await Effect.runPromise(runCli(args).pipe(Effect.provide(runtime)));
			const exported = JSON.parse(output);
			expect(exported.preset).toEqual(preset);
			expect(exported.source).toEqual({
				projectRoot: project,
				generation: null,
				authority: "project_files"
			});
			const rows =
				kind === "game_text" ? exported.result.report.findings : exported.result.records;
			expect(rows.length).toBeGreaterThan(0);
			output = "";
			await Effect.runPromise(
				runCli([...args, "--format", "csv", "--output", outputPath]).pipe(
					Effect.provide(runtime)
				)
			);
			expect(output).toBe("");
			const csv = await readFile(outputPath, "utf8");
			expect(csv).toContain('"metadata"');
			expect(csv).toContain('"record"');
			await writeFile(presetPath, JSON.stringify({ ...preset, schemaVersion: 99 }));
			await expect(
				Effect.runPromise(runCli(args).pipe(Effect.provide(runtime)))
			).rejects.toMatchObject({ _tag: "CliCommandError" });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
	60_000
);

describe.skipIf(!process.env.UE_SHED_UASSET_EXECUTABLE)("localization quality presets", () => {
	const fixture = useSavedFixtureProject();

	it("replays the quality list with the target's review file, as Workbench does", async () => {
		let output = "";
		const runtime = Layer.succeed(
			CliRuntime,
			CliRuntime.of({
				print: (value) =>
					Effect.sync(() => {
						output += value;
					}),
				printError: () => Effect.void,
				setExitCode: (code) => Effect.die(`Unexpected exit ${code}`)
			})
		);
		const run = async (args: readonly string[]) => {
			output = "";
			await Effect.runPromise(runCli(args).pipe(Effect.provide(runtime)));
			return output;
		};
		const preset = {
			schemaVersion: 1,
			kind: "game_text",
			sort: "domain_order",
			query: {
				mode: "quality",
				query: "",
				capability: "all",
				lens: "all",
				qualityFilter: "all",
				workspaceFilter: "format_arguments",
				localization: { target: "FixtureGame", culture: "de" }
			}
		};
		const presetPath = join(fixture.root, "Saved", "localization-quality.json");
		await mkdir(dirname(presetPath), { recursive: true });
		await writeFile(presetPath, JSON.stringify(preset));
		const args = ["investigations", "run", fixture.root, "--preset", presetPath];
		const before = JSON.parse(await run(args));
		expect(before.result).toMatchObject({
			mode: "localization_quality",
			report: { target: "FixtureGame", culture: "de", filter: "format_arguments" }
		});
		expect(before.result.report.findings.length).toBeGreaterThan(0);
		const csv = await run([...args, "--format", "csv"]);
		expect(csv).toContain('"finding_id","kind","culture","source","problem","context"');
		// An accepted finding leaves the replay exactly as it leaves the Workbench list.
		await run([
			"loc",
			"review",
			"accept",
			fixture.root,
			"--target",
			"FixtureGame",
			"--culture",
			"de",
			"--check",
			"localization.format_arguments",
			"--line",
			"Fixture.Localization.Table,NamedArgument"
		]);
		const after = JSON.parse(await run(args));
		expect(after.result.report.findings.length).toBeLessThan(
			before.result.report.findings.length
		);
	}, 60_000);
});
