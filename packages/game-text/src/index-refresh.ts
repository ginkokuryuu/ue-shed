import { performance } from "node:perf_hooks";
import { Context, Effect, Layer, Metric, Schema } from "effect";
import {
	GameTextIndexRefresh,
	GameTextIndexRefreshRequest,
	GameTextIndexError
} from "./index-contract.js";
import { GameTextIndexSteps, makeGameTextIndexSteps } from "./index-steps.js";
export * from "./index-contract.js";

const refreshes = Metric.counter("game_text.index.refreshes");
const refreshDuration = Metric.histogram("game_text.index.refresh_duration_ms", {
	boundaries: [1, 10, 100, 1000, 10000, 60000, 900000]
});

/** Compatibility workflow, composed entirely from the independently usable project/target steps. */
export const gameTextIndexRefreshLayer = (
	cacheRoot: string,
	options: {
		readonly searchWorker?: boolean;
		readonly latestSearchOnly?: boolean;
		readonly syncCallTimeoutMs?: number;
	} = {}
) =>
	Layer.effectContext(
		Effect.gen(function* () {
			const steps = yield* makeGameTextIndexSteps(cacheRoot, options);
			const refresh = Effect.fn("GameTextIndex.refresh")(function* (
				input: GameTextIndexRefreshRequest
			) {
				const request = yield* Schema.decodeUnknownEffect(GameTextIndexRefreshRequest)(
					input
				).pipe(
					Effect.mapError(
						(cause) =>
							new GameTextIndexError({
								operation: "request",
								message: String(cause),
								recovery: "Choose a project and localization target."
							})
					)
				);
				const started = performance.now();
				const selected = yield* steps.openProject(request);
				const imported = yield* steps.importTarget(selected, request);
				const project = yield* steps.refreshProject(request);
				const target = yield* steps.buildTarget(project, imported, request);
				const result = yield* steps.openTarget(target);
				yield* Metric.update(refreshes, 1);
				yield* Metric.update(refreshDuration, performance.now() - started);
				return result;
			});
			return Context.make(GameTextIndexSteps, steps).pipe(
				Context.add(
					GameTextIndexRefresh,
					GameTextIndexRefresh.of({ refresh, invalidate: steps.invalidate })
				)
			);
		})
	);
