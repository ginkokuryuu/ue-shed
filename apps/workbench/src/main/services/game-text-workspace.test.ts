import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { it } from "@effect/vitest";
import {
	makeGameTextWorkspace,
	type GameTextWorkspaceFileHooks,
	type GameTextWorkspaceProject
} from "@ue-shed/game-text/workspace";
import { STARTER_GAME_TEXT_RULES } from "@ue-shed/game-text/rules";
import { makeLocalizationEvidenceTestLayer } from "@ue-shed/localization";
import type { TextCorpus } from "@ue-shed/game-text/schema";
import { Deferred, Effect, Fiber, Ref } from "effect";
import { expect } from "vitest";
import { oracleGameTextIndexLayer } from "./game-text-index.test-support.js";

// The library workspace with host hooks a non-Workbench host would supply (Plan 058 D10).

const emptyCorpus: TextCorpus = {
	coverage: {
		discoveredPackages: 0,
		failedPackages: 0,
		inspectedPackages: 0,
		partialPackages: 0,
		resolvedOccurrences: 0,
		textOccurrences: 0,
		textUnits: 0,
		unresolvedOccurrences: 0,
		unsupportedTextProperties: 0
	},
	diagnostics: [],
	schemaVersion: 1,
	status: "complete",
	units: []
};

const noLocalization = makeLocalizationEvidenceTestLayer({
	discover: () => Effect.succeed({ schemaVersion: 1, targets: [], diagnostics: [] }),
	read: () => Effect.die("No targets"),
	targets: () => Effect.die("Not used")
});

function selected(projectRoot: string): GameTextWorkspaceProject {
	const ready = { status: "ready" as const, project: { projectRoot, generation: 3 } };
	return {
		current: () => Effect.succeed(ready),
		refresh: () => Effect.succeed(ready),
		candidates: () => Effect.succeed({ generation: 3, summary: { projectRoot } }),
		progress: () => Effect.succeed({ completed: 0, total: 0, phase: "idle", stage: "host" })
	};
}

/** Disk-backed hooks that record every write, as a host's writable-file hook would see them. */
function diskFiles(writes: string[]): GameTextWorkspaceFileHooks {
	const failure = (cause: unknown) => ({ message: String(cause), recovery: "Retry." });
	return {
		chooseFile: () => Effect.succeed({ status: "cancelled" }),
		chooseSaveFile: () => Effect.succeed({ status: "cancelled" }),
		readFile: (path) =>
			Effect.tryPromise({ try: () => readFile(path), catch: failure }).pipe(
				Effect.map((bytes) => new Uint8Array(bytes))
			),
		readFileWithin: (directory, relativePath) =>
			Effect.tryPromise({
				try: () => readFile(resolve(directory, relativePath)),
				catch: failure
			}).pipe(Effect.map((bytes) => new Uint8Array(bytes))),
		writeFile: (path, bytes) =>
			Effect.sync(() => writes.push(path)).pipe(
				Effect.andThen(
					Effect.tryPromise({ try: () => writeFile(path, bytes), catch: failure })
				)
			)
	};
}

it.effect("keeps a scan running when the request that started it is interrupted", () =>
	Effect.gen(function* () {
		const started = yield* Deferred.make<void>();
		const finish = yield* Deferred.make<void>();
		const scans = yield* Ref.make(0);
		const scan = Ref.update(scans, (count) => count + 1).pipe(
			Effect.andThen(Deferred.succeed(started, undefined)),
			Effect.andThen(Deferred.await(finish)),
			Effect.as(emptyCorpus)
		);
		yield* Effect.gen(function* () {
			const workspace = yield* makeGameTextWorkspace({
				project: selected("C:/Project"),
				files: diskFiles([])
			});
			const first = yield* workspace.configuredRefresh(true).pipe(Effect.forkChild);
			yield* Deferred.await(started);
			// The window that asked closes; the scan it started does not stop.
			yield* Fiber.interrupt(first);
			// Let the scan finish only after the second request has asked for it.
			yield* Effect.repeat(Effect.yieldNow, { times: 20 }).pipe(
				Effect.andThen(Deferred.succeed(finish, undefined)),
				Effect.forkChild
			);
			expect((yield* workspace.configuredRefresh(true)).status).toBe("completed");
			// The second request joined the running scan instead of starting another.
			expect(yield* Ref.get(scans)).toBe(1);
			expect((yield* workspace.configuredRefresh(false)).status).toBe("completed");
		}).pipe(
			Effect.scoped,
			Effect.provide(oracleGameTextIndexLayer(() => scan)),
			Effect.provide(noLocalization)
		);
	})
);

it.effect("writes starter rules to the host's rules location and keeps a recovery copy", () =>
	Effect.gen(function* () {
		const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "ue-shed-workspace-")));
		const writes: string[] = [];
		const copies: Array<{ readonly path: string; readonly previous: string }> = [];
		yield* Effect.gen(function* () {
			const workspace = yield* makeGameTextWorkspace({
				project: selected(root),
				files: diskFiles(writes),
				rulesRelativePath: "Config/Studio/text-rules.json",
				recoveryCopy: (path, previous) =>
					Effect.sync(() =>
						copies.push({ path, previous: new TextDecoder().decode(previous) })
					)
			});
			expect((yield* workspace.configuredRefresh(true)).status).toBe("completed");
			expect((yield* workspace.createStarterRules(false)).status).toBe("completed");
			const path = resolve(root, "Config/Studio/text-rules.json");
			const starter = yield* Effect.promise(() => readFile(path, "utf8"));
			expect((yield* workspace.saveQualityRules(STARTER_GAME_TEXT_RULES)).status).toBe(
				"completed"
			);
			// The previous file went to the recovery hook before the writable-file hook replaced it.
			expect(copies).toEqual([{ path, previous: starter }]);
			expect(writes).toEqual([path]);
		}).pipe(
			Effect.scoped,
			Effect.provide(oracleGameTextIndexLayer(() => Effect.succeed(emptyCorpus))),
			Effect.provide(noLocalization),
			Effect.ensuring(Effect.promise(() => rm(root, { recursive: true, force: true })))
		);
	})
);
