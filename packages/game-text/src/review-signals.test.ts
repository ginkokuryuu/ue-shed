import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vitest";
import { GameTextIndexRefresh } from "./index-refresh.js";
import { makeIndexRegressionFixture } from "./index-refresh-regressions.test-support.js";
import { joinLocalizationTarget } from "./localization.js";
import { textCorpusQuery } from "./query.js";
import { checkLocalizationTarget } from "./localization-checks.js";

it.live("does not pair a re-keyed place with its gathered or saved previous identity", () =>
	Effect.gen(function* () {
		const fixture = yield* makeIndexRegressionFixture();
		yield* Effect.gen(function* () {
			const index = yield* GameTextIndexRefresh;
			for (const stale of [false, true]) {
				fixture.update([
					occurrence("New", "Source", "Label"),
					...(stale ? [occurrence("K", "Source", "Label")] : [])
				]);
				const indexed = yield* index.refresh(fixture.request);
				const corpus = fixture.raw();
				const join = joinLocalizationTarget(corpus, indexed.evidence);
				const report = checkLocalizationTarget(corpus, join, indexed.evidence, {
					checks: ["duplicate_source"]
				});
				expect(report.findings).toEqual([]);
				const quality = yield* indexed.localizationQuality!({
					checks: ["duplicate_source"]
				});
				expect(quality.findings.length).toBe(0);
				for (const query of [textCorpusQuery(corpus, undefined, join), indexed.query]) {
					const request = { query: "", capability: "all" as const, pageSize: 50 };
					expect(query.search(request).counts.duplicate_source).toBe(0);
					expect(
						query.search({ ...request, localization: { target: fixture.target.name } })
							.counts.duplicate_source
					).toBe(0);
				}
			}
		}).pipe(Effect.provide(fixture.layer()));
	}).pipe(Effect.scoped)
);

it.live("keeps distinct-place duplicates and excludes old keys through source overlays", () =>
	Effect.gen(function* () {
		const fixture = yield* makeIndexRegressionFixture();
		yield* Effect.gen(function* () {
			const index = yield* GameTextIndexRefresh;
			for (const [source, otherProperty, expected] of [
				["Source", "OtherLabel", 2],
				["A".repeat(40), "Label", 0],
				["B".repeat(40), "Label", 0]
			] as const) {
				fixture.update([
					occurrence("New", source, "Label"),
					occurrence("K", source, otherProperty)
				]);
				const indexed = yield* index.refresh(fixture.request);
				const corpus = fixture.raw();
				const join = joinLocalizationTarget(corpus, indexed.evidence);
				const oracle = textCorpusQuery(corpus, undefined, join);
				for (const localization of [undefined, { target: fixture.target.name }]) {
					const request = {
						query: "",
						capability: "all" as const,
						pageSize: 50,
						...(localization ? { localization } : undefined)
					};
					expect(
						indexed.query
							.search(request)
							.units.map(({ reviewSignals }) => reviewSignals)
					).toEqual(
						oracle.search(request).units.map(({ reviewSignals }) => reviewSignals)
					);
					expect(indexed.query.search(request).counts.duplicate_source).toBe(expected);
				}
				const options = { checks: ["duplicate_source" as const] };
				const report = checkLocalizationTarget(corpus, join, indexed.evidence, options);
				const quality = yield* indexed.localizationQuality!(options);
				expect(quality.findings.length).toBe(expected ? 1 : 0);
				expect(report.findings).toHaveLength(quality.findings.length);
				if (source.startsWith("B")) expect(indexed.joined.meta.version).toBe(4);
			}
		}).pipe(Effect.provide(fixture.layer()));
	}).pipe(Effect.scoped)
);

const occurrence = (key: string, source: string, property = key) => ({
	source,
	dev_notes: "",
	identity: { status: "resolved" as const, namespace: "UI", key },
	location: {
		kind: "asset_property" as const,
		object_path: "/Game/Text/Table.Table",
		class_path: "/Script/Engine.DataAsset",
		property_path: property
	},
	edit_capability: "read_only" as const
});

it.live("does not transfer duplicate signals between identities sharing an occurrence ID", () =>
	Effect.gen(function* () {
		const fixture = yield* makeIndexRegressionFixture();
		fixture.update([
			occurrence("K", "Other", "Label"),
			occurrence("New", "Source", "Label"),
			occurrence("Third", "Source", "OtherLabel")
		]);
		yield* Effect.gen(function* () {
			const indexed = yield* (yield* GameTextIndexRefresh).refresh(fixture.request);
			const request = { query: "", capability: "all" as const, pageSize: 50 };
			const oracle = textCorpusQuery(fixture.raw()).search(request);
			expect(oracle.counts.duplicate_source).toBe(2);
			expect(indexed.query.search(request).units).toEqual(oracle.units);
		}).pipe(Effect.provide(fixture.layer()));
	}).pipe(Effect.scoped)
);

it.live("compares canonical place coordinates consistently in memory and the index", () =>
	Effect.gen(function* () {
		const fixture = yield* makeIndexRegressionFixture();
		fixture.update([
			occurrence("K", "Source", "Label[0]"),
			occurrence("New", "Source", "label(0)")
		]);
		yield* Effect.gen(function* () {
			const indexed = yield* (yield* GameTextIndexRefresh).refresh(fixture.request);
			const request = { query: "", capability: "all" as const, pageSize: 50 };
			const oracle = textCorpusQuery(fixture.raw()).search(request);
			expect(oracle.counts.duplicate_source).toBe(0);
			expect(indexed.query.search(request).counts).toEqual(oracle.counts);
		}).pipe(Effect.provide(fixture.layer()));
	}).pipe(Effect.scoped)
);

it.live("keeps case-distinct String Table entries as different places", () =>
	Effect.gen(function* () {
		const fixture = yield* makeIndexRegressionFixture();
		fixture.update(
			["Entry", "entry"].map((key) => ({
				...occurrence(key, "Source"),
				location: {
					kind: "string_table_entry" as const,
					object_path: "/Game/Text/Table.Table",
					entry_key: key
				}
			}))
		);
		yield* Effect.gen(function* () {
			const indexed = yield* (yield* GameTextIndexRefresh).refresh(fixture.request);
			const request = { query: "", capability: "all" as const, pageSize: 50 };
			for (const query of [textCorpusQuery(fixture.raw()), indexed.query])
				expect(query.search(request).counts.duplicate_source).toBe(2);
		}).pipe(Effect.provide(fixture.layer()));
	}).pipe(Effect.scoped)
);

it.live("excludes unresolved text from both sides of duplicate-source matching", () =>
	Effect.gen(function* () {
		const fixture = yield* makeIndexRegressionFixture();
		const text = "A".repeat(40);
		fixture.update([
			occurrence("K", text),
			...(["culture_invariant", "missing_key"] as const).map((reason) => ({
				...occurrence(reason, text),
				identity: { status: "unresolved" as const, reason }
			}))
		]);
		yield* Effect.gen(function* () {
			const index = yield* GameTextIndexRefresh;
			for (const source of [text, "B".repeat(40)]) {
				fixture.setSource(source);
				const indexed = yield* index.refresh(fixture.request);
				const corpus = fixture.raw();
				const oracle = textCorpusQuery(
					corpus,
					undefined,
					joinLocalizationTarget(corpus, indexed.evidence)
				);
				for (const localization of [undefined, { target: fixture.target.name }]) {
					const request = {
						query: "",
						capability: "all" as const,
						pageSize: 50,
						...(localization ? { localization } : undefined)
					};
					for (const query of [oracle, indexed.query]) {
						const page = query.search(request);
						expect(page.counts.duplicate_source).toBe(0);
						expect(page.counts.unresolved).toBe(2);
						expect(page.units.map(({ localization: _marks, ...unit }) => unit)).toEqual(
							oracle
								.search(request)
								.units.map(({ localization: _marks, ...unit }) => unit)
						);
						expect(page.counts).toEqual(oracle.search(request).counts);
					}
				}
			}
		}).pipe(Effect.provide(fixture.layer()));
	}).pipe(Effect.scoped)
);

it.live("measures the longest conflicting source across memory, index and refreshed index", () =>
	Effect.gen(function* () {
		const fixture = yield* makeIndexRegressionFixture();
		const variants = ["Halt!", "Just a traveler.", "Hit the dummy", "Come back soon."];
		yield* Effect.gen(function* () {
			const index = yield* GameTextIndexRefresh;
			for (const texts of [
				variants,
				["A".repeat(40), "B ".repeat(20)],
				["C".repeat(40), "D ".repeat(20)]
			]) {
				fixture.update(texts.map((text, i) => occurrence("K", text, `Label${i}`)));
				const indexed = yield* index.refresh(fixture.request);
				const corpus = fixture.raw();
				const oracle = textCorpusQuery(
					corpus,
					undefined,
					joinLocalizationTarget(corpus, indexed.evidence)
				);
				const longest = [...texts].sort(
					(a, b) => b.length - a.length || (a < b ? -1 : 1)
				)[0]!;
				for (const localization of [undefined, { target: fixture.target.name }]) {
					const request = {
						query: "",
						capability: "all" as const,
						pageSize: 50,
						...(localization ? { localization } : undefined)
					};
					const expected = oracle.search(request);
					for (const query of [oracle, indexed.query]) {
						const page = query.search(request);
						expect(page.units[0]?.characterCount).toBe(longest.length);
						expect(page.units[0]?.wordCount).toBe(longest.trim().split(/\s+/u).length);
						expect(page.units[0]?.reviewSignals.includes("long")).toBe(
							longest.length >= 40
						);
						expect(page.units).toEqual(expected.units);
						expect(page.counts).toEqual(expected.counts);
					}
				}
			}
		}).pipe(Effect.provide(fixture.layer()));
	}).pipe(Effect.scoped)
);
