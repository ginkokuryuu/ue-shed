import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Ref } from "effect";
import { expect } from "vitest";
import { GameTextIndexRefresh } from "@ue-shed/game-text";
import { makeIndexRegressionFixture } from "../../../../../packages/game-text/dist/index-refresh-regressions.test-support.js";
import { WorkbenchGameText, WorkbenchGameTextLive } from "./game-text.js";
import { makeWorkbenchProjectTestLayer } from "./project-workspace.js";
import { ElectronDialog } from "../adapters/electron-dialog.js";
import { makeLocalFilesTestLayer } from "../adapters/local-files.js";
import { makeGameTextLocalization } from "./game-text-localization.js";

const makeHost = Effect.fn("Test.GameText.productionHost")(function* (
	mode: "retirement" | "search" | "rejected"
) {
	const fixture = yield* makeIndexRegressionFixture();
	const retiring = yield* Deferred.make<void>();
	const allowRetirement = yield* Deferred.make<void>();
	const searching = yield* Deferred.make<void>();
	const allowSearch = yield* Deferred.make<void>();
	const prepared = yield* Deferred.make<void>();
	const allowPublication = yield* Deferred.make<void>();
	const generation = yield* Ref.make(0);
	let calls = 0;
	let pauseRetirement = false;
	const indexed = Layer.effect(
		GameTextIndexRefresh,
		Effect.gen(function* () {
			const real = yield* GameTextIndexRefresh;
			return GameTextIndexRefresh.of({
				invalidate: real.invalidate,
				refresh: Effect.fn("Test.GameText.productionRefresh")(function* (request) {
					const call = ++calls;
					if (call === 1)
						yield* Effect.addFinalizer(() =>
							Deferred.succeed(retiring, undefined).pipe(
								Effect.andThen(
									mode === "retirement" && pauseRetirement
										? Deferred.await(allowRetirement)
										: Effect.void
								)
							)
						);
					const result = yield* real.refresh(request);
					if (call === 2 && mode === "rejected") {
						yield* Deferred.succeed(prepared, undefined);
						yield* Deferred.await(allowPublication);
					}
					return {
						...result,
						search: Effect.fn("Test.GameText.productionSearch")(function* (request) {
							if (call === 1 && mode === "search") {
								yield* Deferred.succeed(searching, undefined);
								yield* Deferred.await(allowSearch);
							}
							return yield* result.search(request);
						})
					};
				})
			});
		})
	).pipe(Layer.provide(fixture.layer(true)));
	const current = () =>
		Ref.get(generation).pipe(
			Effect.map((generation) => ({
				status: "ready" as const,
				project: {
					generation,
					inputAtlas: "ready" as const,
					mapCount: 0,
					packageCount: 1,
					projectName: "Fixture",
					projectRoot: fixture.projectRoot
				}
			}))
		);
	const project = makeWorkbenchProjectTestLayer({
		current,
		choose: current,
		inputAtlas: () => Effect.die("Not used"),
		savedTables: () => Effect.die("Not used"),
		savedProject: () => Effect.succeed({ maps: [], projectRoot: fixture.projectRoot }),
		candidates: () =>
			Ref.get(generation).pipe(
				Effect.map((generation) => ({
					generation,
					assets: [],
					failures: [],
					summary: {
						cacheHits: 0,
						depth: "header" as const,
						diagnostics: [],
						emittedAssets: 0,
						failedAssets: 0,
						partialAssets: 0,
						projectRoot: fixture.projectRoot,
						roots: [],
						scannedAssets: 0,
						schema_version: 8 as const,
						skippedAssets: 0
					}
				}))
			)
	});
	const adapters = Layer.mergeAll(
		makeLocalFilesTestLayer(),
		Layer.succeed(
			ElectronDialog,
			ElectronDialog.of({
				chooseDirectory: () => Effect.succeed({ status: "cancelled" }),
				chooseFile: () => Effect.succeed({ status: "cancelled" }),
				chooseFiles: () => Effect.succeed({ status: "cancelled" }),
				chooseSaveFile: () => Effect.succeed({ status: "cancelled" })
			})
		)
	);
	return {
		armRetirement: () => {
			pauseRetirement = true;
		},
		fixture,
		retiring,
		allowRetirement,
		searching,
		allowSearch,
		prepared,
		allowPublication,
		generation,
		layer: WorkbenchGameTextLive.pipe(
			Layer.provide(indexed),
			Layer.provide(project),
			Layer.provide(adapters),
			Layer.provide(fixture.evidence)
		)
	};
});

const request = { query: "", capability: "all" as const, pageSize: 10 };

it.live(
	"publishes the replacement before old reader and worker finalization completes",
	() =>
		Effect.gen(function* () {
			const test = yield* makeHost("retirement");
			yield* Effect.gen(function* () {
				const host = yield* WorkbenchGameText;
				expect((yield* host.configuredRefresh()).status).toBe("completed");
				const before = yield* host.search(request);
				if (before.status !== "ready") throw new Error("Expected initial search");
				const id = before.page.units[0]!.id;
				test.armRetirement();
				test.fixture.setSource("Replacement");
				const refresh = yield* host.configuredRefresh().pipe(Effect.forkChild);
				yield* Deferred.await(test.retiring);
				const focus = yield* host.focus({ id, pageSize: 10 });
				expect(focus).toMatchObject({
					status: "found",
					focus: { unit: { source: { value: "Replacement" } } }
				});
				const searched = yield* host.search(request);
				expect(searched).toMatchObject({
					status: "ready",
					page: { units: [{ source: { value: "Replacement" } }] }
				});
				yield* Deferred.succeed(test.allowRetirement, undefined);
				expect((yield* Fiber.join(refresh)).status).toBe("completed");
			}).pipe(
				Effect.ensuring(Deferred.succeed(test.allowRetirement, undefined)),
				Effect.provide(test.layer)
			);
		}),
	15000
);

it.live(
	"keeps an outstanding search pinned while publishing a rescan",
	() =>
		Effect.gen(function* () {
			const test = yield* makeHost("search");
			yield* Effect.gen(function* () {
				const host = yield* WorkbenchGameText;
				expect((yield* host.configuredRefresh()).status).toBe("completed");
				const pending = yield* host.search(request).pipe(Effect.forkChild);
				yield* Deferred.await(test.searching);
				test.fixture.setSource("Replacement");
				expect((yield* host.configuredRefresh()).status).toBe("completed");
				expect(yield* Deferred.isDone(test.retiring)).toBe(false);
				yield* Deferred.succeed(test.allowSearch, undefined);
				expect((yield* Fiber.join(pending)).status).toBe("not_ready");
				yield* Deferred.await(test.retiring);
				expect((yield* host.search(request)).status).toBe("ready");
			}).pipe(
				Effect.ensuring(Deferred.succeed(test.allowSearch, undefined)),
				Effect.provide(test.layer)
			);
		}),
	15000
);

it.live(
	"a rejected prepared refresh preserves the previously published reader and worker",
	() =>
		Effect.gen(function* () {
			const test = yield* makeHost("rejected");
			yield* Effect.gen(function* () {
				const host = yield* WorkbenchGameText;
				expect((yield* host.configuredRefresh()).status).toBe("completed");
				const pending = yield* host.configuredRefresh().pipe(Effect.forkChild);
				yield* Deferred.await(test.prepared);
				yield* Ref.set(test.generation, 1);
				yield* Deferred.succeed(test.allowPublication, undefined);
				expect((yield* Fiber.join(pending)).status).toBe("failed");
				yield* Ref.set(test.generation, 0);
				expect((yield* host.search(request)).status).toBe("ready");
				expect(yield* Deferred.isDone(test.retiring)).toBe(false);
			}).pipe(
				Effect.ensuring(Deferred.succeed(test.allowPublication, undefined)),
				Effect.provide(test.layer)
			);
		}),
	15000
);

it.live(
	"target replacement preserves outstanding localization searches until they finish",
	() =>
		Effect.gen(function* () {
			const fixture = yield* makeIndexRegressionFixture();
			const other = fixture.addTarget("Other");
			const searching = yield* Deferred.make<void>();
			const allowSearch = yield* Deferred.make<void>();
			const retiring = yield* Deferred.make<void>();
			const indexed = Layer.effect(
				GameTextIndexRefresh,
				Effect.gen(function* () {
					const real = yield* GameTextIndexRefresh;
					return GameTextIndexRefresh.of({
						invalidate: real.invalidate,
						refresh: Effect.fn("Test.GameText.targetRefresh")(function* (request) {
							if (request.targetName === fixture.target.name)
								yield* Effect.addFinalizer(() =>
									Deferred.succeed(retiring, undefined)
								);
							const result = yield* real.refresh(request);
							return {
								...result,
								search: Effect.fn("Test.GameText.targetSearch")(
									function* (request) {
										if (
											request.localization?.target === fixture.target.name &&
											request.query === "Source"
										) {
											yield* Deferred.succeed(searching, undefined);
											yield* Deferred.await(allowSearch);
										}
										return yield* result.search(request);
									}
								)
							};
						})
					});
				})
			).pipe(Layer.provide(fixture.layer(true)));
			yield* Effect.gen(function* () {
				const raw = fixture.raw();
				const host = yield* makeGameTextLocalization(
					() => Effect.succeed(raw),
					() => Effect.succeed(fixture.projectRoot)
				);
				expect((yield* Effect.scoped(host.select(fixture.target.name))).status).toBe(
					"ready"
				);
				const pending = yield* host
					.search({
						...request,
						query: "Source",
						localization: { target: fixture.target.name }
					})
					.pipe(Effect.scoped, Effect.forkChild);
				yield* Deferred.await(searching);
				expect((yield* Effect.scoped(host.select(other.name))).status).toBe("ready");
				expect(yield* Deferred.isDone(retiring)).toBe(false);
				yield* Deferred.succeed(allowSearch, undefined);
				expect((yield* Fiber.join(pending)).status).toBe("not_ready");
				yield* Deferred.await(retiring);
				expect(
					(yield* Effect.scoped(
						host.search({ ...request, localization: { target: other.name } })
					)).status
				).toBe("ready");
			}).pipe(
				Effect.ensuring(Deferred.succeed(allowSearch, undefined)),
				Effect.provide(indexed),
				Effect.provide(fixture.evidence)
			);
		}),
	15000
);
