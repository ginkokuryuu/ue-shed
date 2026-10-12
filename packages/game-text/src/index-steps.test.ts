import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { expect } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GameTextIndexSteps, gameTextIndexStepsLayer } from "./index-steps.js";
import { GameTextIndexRefresh, GameTextIndexSource } from "./index-refresh.js";
import { typeScriptIndexBuilderLayer } from "./index-builder.js";
import { SharedIndex, sharedIndexNodeLayer } from "./shared-index.js";
import { makeIndexRegressionFixture } from "./index-refresh-regressions.test-support.js";

it.live(
	"composes source and concurrent target views over one verified project revision",
	() =>
		Effect.gen(function* () {
			const fixture = yield* makeIndexRegressionFixture();
			const other = fixture.addTarget("SavedText");
			yield* Effect.gen(function* () {
				const steps = yield* GameTextIndexSteps;
				const project = yield* steps.refreshProject({ projectRoot: fixture.projectRoot });
				const sourceImport = yield* steps.importTarget(project);
				const source = yield* steps.openTarget(
					yield* steps.buildTarget(project, sourceImport)
				);
				const imports = yield* Effect.all(
					[fixture.target, other].map((target) =>
						steps.importTarget(project, { targetName: target.name })
					),
					{ concurrency: 2 }
				);
				const targets = yield* Effect.all(
					imports.map((imported) => steps.buildTarget(project, imported)),
					{ concurrency: 2 }
				);
				const opened = yield* Effect.all(targets.map(steps.openTarget), { concurrency: 2 });
				expect(fixture.inventories()).toBe(1);
				expect(fixture.packageReads()).toBe(1);
				expect(opened.map((result) => result.localizationJoin.target)).toEqual([
					fixture.target.name,
					other.name
				]);
				const sourceAgain = yield* steps.buildTarget(project, sourceImport);
				expect(sourceAgain.join.rebuilt).toBe(false);
				expect(sourceAgain.join.key).toBe(source.join.key);
				const reordered = yield* SharedIndex.use((index) => index.inspect()).pipe(
					Effect.provide(
						sharedIndexNodeLayer({
							cacheRoot: join(fixture.projectRoot, "cache"),
							projectKey: fixture.projectRoot,
							targetKey: fixture.target.name,
							projectView: { target: fixture.target.name, kind: "localization" }
						})
					)
				);
				expect(reordered.active.joined).toBe(targets[0]?.join.key);
				const compatibility = yield* (yield* GameTextIndexRefresh).refresh(fixture.request);
				expect(compatibility.corpus).toEqual(opened[0]?.corpus);
				expect(compatibility.localizationJoin).toEqual(opened[0]?.localizationJoin);
			}).pipe(Effect.provide(fixture.layer(true)));
		}).pipe(Effect.scoped),
	15000
);

it.live("imports and validates localization without starting package discovery", () =>
	Effect.gen(function* () {
		const fixture = yield* makeIndexRegressionFixture();
		yield* Effect.gen(function* () {
			const steps = yield* GameTextIndexSteps;
			const selected = yield* steps.openProject({ projectRoot: fixture.projectRoot });
			const imported = yield* steps.importTarget(selected, {
				targetName: fixture.target.name,
				requireManifest: true
			});
			expect(fixture.inventories()).toBe(0);
			expect(fixture.packageReads()).toBe(0);
			const project = yield* steps.refreshProject({ projectRoot: fixture.projectRoot });
			const result = yield* steps.openTarget(yield* steps.buildTarget(project, imported));
			expect(result.localizationJoin.lines).toHaveLength(1);
			expect(fixture.inventories()).toBe(1);
		}).pipe(Effect.provide(fixture.layer()));
	}).pipe(Effect.scoped)
);

it.live(
	"rejects stale project revisions and invalidated target handles, preserving pinned queries",
	() =>
		Effect.gen(function* () {
			const fixture = yield* makeIndexRegressionFixture();
			yield* Effect.gen(function* () {
				const steps = yield* GameTextIndexSteps;
				const project = yield* steps.refreshProject({ projectRoot: fixture.projectRoot });
				const imported = yield* steps.importTarget(project, fixture.request);
				const target = yield* steps.buildTarget(project, imported);
				const pinned = yield* steps.openTarget(target);
				const search = { query: "Source", capability: "all" as const, pageSize: 10 };
				const original = pinned.query.search(search);
				yield* steps.invalidate(fixture.request);
				expect(yield* steps.openTarget(target).pipe(Effect.flip)).toMatchObject({
					_tag: "GameTextIndexError",
					operation: "target",
					retrySafe: true
				});
				fixture.setSource("Updated");
				const next = yield* steps.refreshProject({ projectRoot: fixture.projectRoot });
				expect(yield* steps.buildTarget(project, imported).pipe(Effect.flip)).toMatchObject(
					{
						_tag: "GameTextIndexError",
						operation: "project"
					}
				);
				const updated = yield* steps.openTarget(yield* steps.buildTarget(next, imported));
				expect(updated.query.search({ ...search, query: "Updated" }).total).toBe(1);
				expect(pinned.query.search(search)).toEqual(original);
			}).pipe(Effect.provide(fixture.layer()));
		}).pipe(Effect.scoped)
);

it.live("cancellation releases the project writer so a queued refresh can complete", () =>
	Effect.gen(function* () {
		const fixture = yield* makeIndexRegressionFixture();
		const reading = yield* Deferred.make<void>();
		const hold = yield* Deferred.make<void>();
		fixture.pauseReads(
			Deferred.succeed(reading, undefined).pipe(Effect.andThen(Deferred.await(hold)))
		);
		yield* Effect.gen(function* () {
			const steps = yield* GameTextIndexSteps;
			const first = yield* steps
				.refreshProject({ projectRoot: fixture.projectRoot })
				.pipe(Effect.forkChild);
			yield* Deferred.await(reading);
			fixture.pauseReads(Effect.void);
			const queued = yield* steps
				.refreshProject({ projectRoot: fixture.projectRoot })
				.pipe(Effect.forkChild);
			yield* Fiber.interrupt(first);
			const project = yield* Fiber.join(queued);
			const result = yield* steps.openTarget(
				yield* steps.buildTarget(project, yield* steps.importTarget(project))
			);
			expect(
				result.query.search({ query: "Source", capability: "all", pageSize: 10 }).total
			).toBe(1);
		}).pipe(Effect.provide(fixture.layer()));
	}).pipe(Effect.scoped)
);

it.live("rejects an import superseded by another localization publication", () =>
	Effect.gen(function* () {
		const fixture = yield* makeIndexRegressionFixture();
		yield* Effect.gen(function* () {
			const steps = yield* GameTextIndexSteps;
			const project = yield* steps.refreshProject({ projectRoot: fixture.projectRoot });
			const old = yield* steps.importTarget(project, fixture.request);
			yield* Effect.promise(() =>
				writeFile(
					join(fixture.projectRoot, "de.po"),
					fixture.contents.po.replace("Shipped", "New")
				)
			);
			const current = yield* steps.importTarget(project, fixture.request);
			expect(yield* steps.buildTarget(project, old).pipe(Effect.flip)).toMatchObject({
				_tag: "GameTextIndexError",
				operation: "localization"
			});
			const result = yield* steps.openTarget(yield* steps.buildTarget(project, current));
			expect(
				result.localizationJoin.lines[0]?.cultures.some(
					(culture) => culture.poTranslation === "New"
				)
			).toBe(true);
			expect(fixture.inventories()).toBe(1);
		}).pipe(Effect.provide(fixture.layer()));
	}).pipe(Effect.scoped)
);

it.live("a paused project writer does not block a different project's refresh", () =>
	Effect.gen(function* () {
		const firstProject = yield* makeIndexRegressionFixture();
		const otherProject = yield* makeIndexRegressionFixture();
		const reading = yield* Deferred.make<void>();
		const hold = yield* Deferred.make<void>();
		firstProject.pauseReads(
			Deferred.succeed(reading, undefined).pipe(Effect.andThen(Deferred.await(hold)))
		);
		const firstSource = yield* GameTextIndexSource.pipe(Effect.provide(firstProject.source));
		const otherSource = yield* GameTextIndexSource.pipe(Effect.provide(otherProject.source));
		const source = Layer.succeed(GameTextIndexSource, {
			inventory: (request) =>
				(request.projectRoot === firstProject.projectRoot
					? firstSource
					: otherSource
				).inventory(request),
			read: (root, entries) =>
				(root === firstProject.projectRoot ? firstSource : otherSource).read(root, entries)
		});
		yield* Effect.gen(function* () {
			const steps = yield* GameTextIndexSteps;
			const paused = yield* steps
				.refreshProject({ projectRoot: firstProject.projectRoot })
				.pipe(Effect.forkChild);
			yield* Deferred.await(reading);
			const independent = yield* steps.refreshProject({
				projectRoot: otherProject.projectRoot
			});
			expect(independent.projectRoot).toBe(otherProject.projectRoot);
			expect(otherProject.packageReads()).toBe(1);
			yield* Fiber.interrupt(paused);
		}).pipe(
			Effect.provide(
				gameTextIndexStepsLayer(join(firstProject.projectRoot, "cache")).pipe(
					Layer.provide(source),
					Layer.provide(typeScriptIndexBuilderLayer),
					Layer.provide(firstProject.evidence)
				)
			)
		);
	}).pipe(Effect.scoped)
);
