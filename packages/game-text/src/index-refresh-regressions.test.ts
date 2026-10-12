import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vitest";
import { LocalizationEvidence } from "@ue-shed/localization";
import { GameTextIndexRefresh } from "./index-refresh.js";
import { makeIndexRegressionFixture } from "./index-refresh-regressions.test-support.js";
import { joinLocalizationTarget } from "./localization.js";
import { textCorpusQuery } from "./query.js";

// Facts are unordered flags; all evidence, primary states and unknown reasons compare exactly.
const orderedFacts = (join: ReturnType<typeof joinLocalizationTarget>) => ({
	...join,
	lines: join.lines.map((line) => ({
		...line,
		cultures: line.cultures.map((culture) => ({
			...culture,
			facts: [...culture.facts].sort()
		}))
	}))
});

it.live.each(["manifest", "archive", "po"] as const)(
	"keeps failed current %s input distinct from pinned historical evidence and repairs",
	(kind) =>
		Effect.gen(function* () {
			const fixture = yield* makeIndexRegressionFixture();
			const file = kind === "manifest" ? "Review.manifest" : `de.${kind}`;
			const saved = fixture.contents[kind];
			yield* Effect.gen(function* () {
				const index = yield* GameTextIndexRefresh;
				const first = yield* index.refresh(fixture.request);
				const pinned = first.localizationJoin.lines;
				for (const broken of ["malformed", "missing"] as const) {
					yield* Effect.promise(() =>
						broken === "missing"
							? unlink(join(fixture.projectRoot, file))
							: writeFile(join(fixture.projectRoot, file), "not a localization file")
					);
					const failed = yield* index.refresh(fixture.request);
					const culture = failed.evidence.cultures.find((item) => item.culture === "de");
					const currentFile =
						kind === "manifest" ? failed.evidence.manifest : culture?.[kind];
					expect(currentFile?.status).toBe("failed");
					if (!currentFile || currentFile.status !== "failed")
						throw new Error("Expected failed current input");
					expect(currentFile.error.code === "file_missing").toBe(broken === "missing");
					const oracle = yield* Effect.gen(function* () {
						return yield* (yield* LocalizationEvidence).read({
							projectRoot: fixture.projectRoot,
							target: fixture.target
						});
					}).pipe(Effect.provide(fixture.evidence));
					const expected = joinLocalizationTarget(fixture.raw(), oracle);
					expect(orderedFacts(failed.localizationJoin)).toEqual(orderedFacts(expected));
					const search = {
						query: "",
						capability: "all" as const,
						pageSize: 10,
						localization: {
							target: fixture.target.name,
							culture: fixture.target.cultures[1]!
						}
					};
					expect(failed.query.search(search).localization?.counts).toEqual(
						textCorpusQuery(fixture.raw(), undefined, expected).search(search)
							.localization?.counts
					);
					const reopened = yield* Effect.gen(function* () {
						return yield* (yield* GameTextIndexRefresh).refresh(fixture.request);
					}).pipe(Effect.provide(fixture.layer(), { local: true }));
					expect(reopened.localizationJoin).toEqual(failed.localizationJoin);
					expect(first.localizationJoin.lines).toEqual(pinned);
					expect(first.corpus).toEqual(fixture.raw());
					yield* Effect.promise(() => writeFile(join(fixture.projectRoot, file), saved));
					const repaired = yield* index.refresh(fixture.request);
					expect(repaired.localizationJoin.lines).toEqual(pinned);
				}
			}).pipe(Effect.provide(fixture.layer()));
		})
);

it.live("raw corpus retains invisible units and empty-source String Table evidence", () =>
	Effect.gen(function* () {
		const fixture = yield* makeIndexRegressionFixture();
		const base = {
			dev_notes: "",
			edit_capability: "read_only" as const,
			location: {
				kind: "asset_property" as const,
				object_path: "/Game/Text/Table.Table",
				class_path: "/Script/Engine.DataAsset",
				property_path: "Label"
			}
		};
		fixture.update([
			...(["Visible", "", " \t\r\n"] as const).map((source, index) => ({
				...base,
				source,
				identity: { status: "resolved" as const, namespace: "UI", key: `K${index}` }
			})),
			{
				...base,
				source: "",
				identity: {
					status: "string_table" as const,
					table_id: "/Game/Text/ST_Empty.ST_Empty",
					key: "Empty"
				}
			}
		]);
		const indexed = yield* Effect.gen(function* () {
			return yield* (yield* GameTextIndexRefresh).refresh({
				projectRoot: fixture.projectRoot
			});
		}).pipe(Effect.provide(fixture.layer()));
		expect(indexed.corpus).toEqual(fixture.raw());
		expect(indexed.corpus.units).toHaveLength(4);
		expect(indexed.corpus.coverage.textOccurrences).toBe(4);
		const search = { query: "", capability: "all" as const, pageSize: 10 };
		const oracle = textCorpusQuery(fixture.raw());
		expect(indexed.query.search(search).total).toBe(oracle.search(search).total);
		expect(indexed.query.export(search)).toEqual(oracle.export(search));
	})
);
