import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vitest";
import { GameTextIndexRefresh } from "../packages/game-text/src/index-refresh.ts";
import { makeIndexRegressionFixture } from "../packages/game-text/src/index-refresh-regressions.test-support.ts";
import { coveredMs, makeStageRecorder } from "./game-text-stage-timings.ts";

it("counts overlapping intervals once and adds separate ones", () => {
	const ms = (value: number) => BigInt(value * 1e6);
	expect(coveredMs([])).toBe(0);
	expect(
		coveredMs([
			[ms(10), ms(20)],
			[ms(0), ms(5)],
			[ms(15), ms(30)],
			[ms(18), ms(19)]
		])
	).toBe(25);
});

it.effect("summarizes span wall time and in-step stage attributes by name", () =>
	Effect.gen(function* () {
		const recorder = makeStageRecorder();
		const step = (stage: number) =>
			Effect.annotateCurrentSpan({ "step.stage_ms.read": stage, "step.lines": 3 }).pipe(
				Effect.withSpan("Step")
			);
		yield* Effect.all([step(2), step(5)], { concurrency: 2 }).pipe(
			Effect.withSpan("Run"),
			Effect.withTracer(recorder.tracer)
		);
		const counts = recorder.counts();
		expect(counts["stage.Step.count"]).toBe(2);
		expect(counts["stage.Run.count"]).toBe(1);
		// Only stage attributes are summed; other attributes stay out of the summary.
		expect(counts["stage.Step.step.stage_ms.read"]).toBe(7);
		expect(counts["stage.Step.step.lines"]).toBeUndefined();
		expect(counts["stage.Run.wallMs"]).toBeGreaterThanOrEqual(counts["stage.Step.wallMs"]!);
	})
);

it.live("records the join and quality scan stages of a real index build", () =>
	Effect.gen(function* () {
		const fixture = yield* makeIndexRegressionFixture();
		const recorder = makeStageRecorder();
		yield* Effect.gen(function* () {
			const refresh = yield* GameTextIndexRefresh;
			const result = yield* refresh.refresh(fixture.request);
			yield* result.localizationQuality!({ review: result.review.file });
		}).pipe(Effect.scoped, Effect.provide(fixture.layer()), Effect.withTracer(recorder.tracer));
		const counts = recorder.counts();
		for (const stage of ["inputs", "order", "lines", "query_places", "publish"])
			expect(counts[`stage.JoinedTarget.refresh.join.stage_ms.${stage}`]).toBeGreaterThan(0);
		for (const stage of ["prepare", "units", "order", "scan", "scan.check", "columns"])
			expect(
				counts[`stage.GameText.localizationQuality.game_text.quality.stage_ms.${stage}`]
			).toBeGreaterThanOrEqual(0);
		expect(counts["stage.PackageText.refresh.package-text.stage_ms.selection"]).toBeDefined();
		expect(counts["stage.GameTextIndex.openTarget.count"]).toBe(1);
	})
);
