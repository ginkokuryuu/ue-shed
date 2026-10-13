import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { expect } from "vitest";
import { GameTextIndexRefresh } from "./index-refresh.js";
import { makeSyntheticHostFixture, withEventLoopGaps } from "./host-responsiveness.test-support.js";

/** Run alone through `pnpm test:game-text:responsiveness`, which `pnpm check` includes. Timer
 * gaps measure the whole process, so parallel test files would turn their load into failures.
 */
const enabled = process.env.UE_SHED_HOST_RESPONSIVENESS === "1";

/** Host work runs in 16 ms slices and locally stays under 100 ms. The budget leaves room for a
 * slower CI runner (about twice the local slice cost) and for a major GC pause in the same
 * stretch, while still failing on any unsliced pass over the inventory or the occurrences.
 */
const MAXIMUM_GAP_MS = 250;

it.live.skipIf(!enabled)(
	"keeps the event loop responsive through cold and warm refreshes",
	() =>
		Effect.gen(function* () {
			const fixture = yield* makeSyntheticHostFixture({
				inventory: 150_000,
				textPackages: 2_000,
				occurrencesPerPackage: 25,
				keys: 10_000
			});
			const context = yield* Layer.build(fixture.layer);
			const service = yield* GameTextIndexRefresh.pipe(Effect.provide(context));
			const refresh = Effect.scoped(
				service
					.refresh(fixture.request)
					.pipe(
						Effect.tap((result) =>
							result.search({ query: "", capability: "all", pageSize: 50 })
						)
					)
			);
			const cold = yield* withEventLoopGaps(refresh);
			expect(cold.value.packages.readPackages).toBe(fixture.textPackages);
			expect(cold.value.join.rebuilt).toBe(true);
			expect(cold.maxGapMs).toBeLessThan(MAXIMUM_GAP_MS);
			const warm = yield* withEventLoopGaps(refresh);
			yield* Effect.logInfo("Host event-loop gaps").pipe(
				Effect.annotateLogs({ coldMaxGapMs: cold.maxGapMs, warmMaxGapMs: warm.maxGapMs })
			);
			expect(warm.value.packages.readPackages).toBe(0);
			expect(warm.value.join.rebuilt).toBe(false);
			expect(warm.maxGapMs).toBeLessThan(MAXIMUM_GAP_MS);
		}),
	180_000
);
