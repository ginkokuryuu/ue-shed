import { it } from "@effect/vitest";
import { Effect, Fiber, Metric } from "effect";
import { expect } from "vitest";
import { GameTextIndexRefresh } from "./index-refresh.js";
import { makeIndexRegressionFixture } from "./index-refresh-regressions.test-support.js";
import type { LocalizationQuality } from "./localization-workspace.js";
import type { LocalizationQualityProgress } from "./localization-quality-index.js";
import { TextQualityFindingId } from "./quality-query.js";

const occurrence = (key: string, source: string) => ({
	source,
	dev_notes: "",
	identity: { status: "resolved" as const, namespace: "UI", key },
	location: {
		kind: "asset_property" as const,
		object_path: "/Game/Text/Table.Table",
		class_path: "/Script/Engine.DataAsset",
		property_path: `Label${key}`
	},
	edit_capability: "read_only" as const
});

/** Everything a workspace can read from a scan, read the same way from either side. */
function readAll(quality: LocalizationQuality) {
	const { findings, metadata } = quality;
	const positions = Array.from({ length: findings.length }, (_, position) => position);
	const items = findings.items(positions);
	const cultures = [undefined, ...metadata.join.cultures];
	return {
		length: findings.length,
		groups: findings.groups?.map((group) => ({ ...group, positions: [...group.positions] })),
		facts: positions.map((position) => [
			findings.culture(position),
			findings.filter(position),
			findings.ruleId(position),
			findings.eligible(position),
			findings.reportedBySource(position)
		]),
		items,
		found: items.map((item) => findings.find(item.summary.id, item.summary.culture)),
		missing: findings.find(
			TextQualityFindingId.make("localization-finding:0000000000000000"),
			undefined
		),
		limits: cultures.map((culture) => findings.limits(culture)),
		join: metadata.join,
		rules: metadata.rules,
		status: metadata.status,
		coverage: metadata.coverage,
		unsupportedRuleCultures: metadata.unsupportedRuleCultures
	};
}

it.live(
	"scans in the quality worker with the same findings, items and lookups as the host",
	() =>
		Effect.gen(function* () {
			const fixture = yield* makeIndexRegressionFixture();
			fixture.update(
				["K", "A", "B"].map((key) => occurrence(key, ` Source {Name} ${key}  `))
			);
			const scan = (qualityWorker: boolean) =>
				Effect.gen(function* () {
					const refresh = yield* GameTextIndexRefresh;
					const result = yield* refresh.refresh(fixture.request);
					const progress: LocalizationQualityProgress[] = [];
					const quality = yield* result.localizationQuality!({
						review: result.review.file,
						onProgress: (event) => progress.push(event)
					});
					const unit = result.query.search({ query: "", capability: "all", pageSize: 1 })
						.units[0]!;
					return {
						read: readAll(quality),
						line: quality.metadata.lineOfUnit(unit.id),
						sourceKey: quality.metadata.sourceKeyOfUnit?.(unit.id),
						lastProgress: progress.at(-1),
						firstProgress: progress[0]
					};
				}).pipe(
					Effect.scoped,
					Effect.provide(fixture.layer(false, fixture.source, qualityWorker))
				);
			const completed = Metric.counter("game_text.index.worker_quality_scans_completed");
			const before = (yield* Metric.value(completed)).count;
			const host = yield* scan(false);
			expect((yield* Metric.value(completed)).count).toBe(before);
			const worker = yield* scan(true);
			// The worker really ran the scan, rather than falling back to the host.
			expect((yield* Metric.value(completed)).count).toBe(before + 1);
			expect(host.read.length).toBeGreaterThan(0);
			expect(host.line).toBeDefined();
			expect(host.lastProgress?.checkedLines).toBe(host.lastProgress?.totalLines);
			expect(worker).toEqual(host);
		}),
	30_000
);

it.live(
	"interrupting a worker scan leaves the worker serving the next scan",
	() =>
		Effect.gen(function* () {
			const fixture = yield* makeIndexRegressionFixture();
			yield* Effect.gen(function* () {
				const refresh = yield* GameTextIndexRefresh;
				const result = yield* refresh.refresh(fixture.request);
				const running = yield* Effect.forkChild(result.localizationQuality!());
				yield* Fiber.interrupt(running);
				const quality = yield* result.localizationQuality!();
				expect(quality.findings.items([])).toEqual([]);
				expect(quality.metadata.join.target).toBe(fixture.target.name);
			}).pipe(Effect.scoped, Effect.provide(fixture.layer(false, fixture.source, true)));
		}),
	30_000
);
