import { performance } from "node:perf_hooks";
import { Effect, Metric } from "effect";
import type { TextCorpusQuery } from "./query.js";

const duration = Metric.histogram("game_text.index.query_duration_ms", {
	boundaries: [1, 10, 50, 100, 1000, 10000]
});
const queries = Metric.counter("game_text.index.queries");

/** The existing synchronous query API records the same boundary spans for every host. */
export function instrumentIndexQuery(query: TextCorpusQuery): TextCorpusQuery {
	const measure = <A extends readonly unknown[], B>(name: string, run: (...args: A) => B) => {
		const observed = Effect.fn(`GameTextIndex.query.${name}`)(function* (...args: A) {
			const started = performance.now();
			return yield* Effect.sync(() => run(...args)).pipe(
				Effect.ensuring(
					Effect.gen(function* () {
						yield* Metric.update(queries, 1);
						yield* Metric.update(duration, performance.now() - started);
					})
				)
			);
		});
		return (...args: A) => Effect.runSync(observed(...args));
	};
	return {
		summary: measure("summary", query.summary),
		search: measure("search", query.search),
		focus: measure("focus", query.focus),
		localizationFocus: measure("localizationFocus", query.localizationFocus),
		localizationLines: measure("localizationLines", query.localizationLines),
		export: measure("export", query.export)
	};
}
