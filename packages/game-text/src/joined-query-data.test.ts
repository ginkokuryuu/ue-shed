import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vitest";
import { GameTextIndexRefresh } from "./index-refresh.js";
import { makeIndexRegressionFixture } from "./index-refresh-regressions.test-support.js";
import { JoinedQueryData } from "./joined-query-data.js";

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

it.live("hydrates bulk line reads in pages that match single-line reads", () =>
	Effect.gen(function* () {
		const fixture = yield* makeIndexRegressionFixture();
		fixture.update(["K", "A", "B", "C", "D"].map((key) => occurrence(key, `Source ${key}`)));
		yield* Effect.gen(function* () {
			const refreshed = yield* (yield* GameTextIndexRefresh).refresh(fixture.request);
			const data = new JoinedQueryData(refreshed.joined);
			const rows = Array.from({ length: refreshed.joined.meta.count }, (_, row) => row);
			expect(rows.length).toBeGreaterThanOrEqual(5);
			const single = (picked: readonly number[]) => picked.map((row) => data.line(row));
			expect(data.lines(rows)).toEqual(single(rows));
			const gaps = rows.filter((row) => row !== 1 && row !== 3);
			expect(data.lines(gaps)).toEqual(single(gaps));
			expect(data.lines([...rows].reverse())).toEqual(single([...rows].reverse()));
			const repeated = [rows.at(-1)!, 0, rows.at(-1)!, 0];
			expect(data.lines(repeated)).toEqual(single(repeated));
			expect(data.lines([])).toEqual([]);
		}).pipe(Effect.provide(fixture.layer()));
	}).pipe(Effect.scoped)
);
