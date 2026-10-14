import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { LocalizationReviewFile } from "@ue-shed/localization";
import { expect } from "vitest";
import { GameTextIndexRefresh } from "./index-refresh.js";
import { makeIndexRegressionFixture } from "./index-refresh-regressions.test-support.js";
import { checkLocalizationTarget } from "./localization-checks.js";
import { localizationLineFingerprint } from "./localization-review.js";
import {
	WorkspaceQualityFilter,
	localizationQualityWorkspace,
	localizationQualityWorkspaceOf,
	type WorkspaceQualityRequest
} from "./localization-workspace.js";
import { TextQualityFindingId } from "./quality-query.js";
import { GameTextRuleDocument, evaluateGameTextSourceQuality } from "./quality-rules-v2.js";

/** One problem per key pattern; German carries the translation problems. */
const patterns = [
	{ source: "Hello {PlayerName}", de: "Hallo {Name}" },
	{ source: "<Bold>Gold</>", de: "<Bold>Gold" },
	{ source: "Ready ", de: "Bereit" },
	{ source: "Line one", de: "Zeile\\neins" },
	{ source: "{Count} {Count}|plural(one=item,other=items)", de: "{Count} Dinge" },
	{ source: "Exit", de: "Beenden" },
	{ source: "Empty me", de: "" },
	{ source: "Fine text", de: "Feiner Text" },
	{ source: "Exit", de: "Verlassen" }
];
const keys = Array.from({ length: 30 }, (_, index) => ({
	key: `K${String(index).padStart(2, "0")}`,
	...patterns[index % patterns.length]!
}));
/** Gathered keys; the last few keys exist only in the localization files. */
const gathered = keys.slice(0, 27);
const po = (text: string) => text.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

const occurrence = (key: string, source: string, index: number) => ({
	source,
	dev_notes: index % patterns.length === 7 ? "Shown on the main menu." : "",
	identity: { status: "resolved" as const, namespace: "UI", key },
	location: {
		kind: "asset_property" as const,
		object_path: index % 4 === 0 ? "/Game/UI/Menu.Menu" : "/Game/Text/Table.Table",
		class_path: "/Script/Engine.DataAsset",
		property_path: `Label${index}`
	},
	edit_capability: "read_only" as const
});

const document = Schema.decodeUnknownSync(GameTextRuleDocument)({
	schemaVersion: 2,
	roles: [
		{
			id: "menu",
			scopes: [
				{ matchers: [{ kind: "object_path", operator: "prefix", value: "/Game/UI/" }] }
			]
		}
	],
	rules: [
		{
			id: "source.limit",
			kind: "character_budget",
			role: "menu",
			maximumCharacters: 8,
			recovery: "Shorten the line."
		}
	],
	localizationRules: [
		{
			id: "translation.limit",
			kind: "localization_character_budget",
			role: "menu",
			cultures: { de: 6 },
			recovery: "Shorten the translation."
		},
		{
			id: "translation.terms",
			kind: "localization_terminology",
			role: "menu",
			cultures: { de: [{ kind: "preferred", term: "Willkommen", alternatives: ["Hallo"] }] },
			caseSensitive: false,
			recovery: "Use Willkommen."
		}
	]
});

it.live(
	"indexed quality pages, focus and proposals equal the in-memory workspace",
	() =>
		Effect.gen(function* () {
			const fixture = yield* makeIndexRegressionFixture();
			yield* Effect.promise(async () => {
				const manifest = {
					FormatVersion: 1,
					Namespace: "UI",
					Children: keys.map(({ key, source }, index) => ({
						Source: { Text: source },
						Keys: [{ Key: key, Path: `/Game/Text/Table.Table.Label${index}` }]
					}))
				};
				const archive = (culture: "en" | "de") => ({
					FormatVersion: 2,
					Namespace: "UI",
					Children: keys.map(({ key, source, de }) => ({
						Key: key,
						Source: { Text: source },
						Translation: { Text: culture === "en" ? source : de }
					}))
				});
				// German ships the escape from its archive: Unreal's PO import would unescape it.
				const portable = (culture: "en" | "de") =>
					keys
						.filter(({ source }) => culture === "en" || source !== "Line one")
						.map(
							({ key, source, de }) =>
								`msgctxt "UI,${key}"\nmsgid "${po(source)}"\nmsgstr "${po(culture === "en" ? source : de)}"\n`
						)
						.join("\n");
				await writeFile(
					join(fixture.projectRoot, "Review.manifest"),
					JSON.stringify(manifest)
				);
				for (const culture of ["en", "de"] as const) {
					await writeFile(
						join(fixture.projectRoot, `${culture}.archive`),
						JSON.stringify(archive(culture))
					);
					await writeFile(join(fixture.projectRoot, `${culture}.po`), portable(culture));
				}
			});
			fixture.update([
				...gathered.map(({ key, source }, index) => occurrence(key, source, index)),
				// A second location for one key, an ungathered key and a culture-invariant text.
				occurrence("K00", "Hello {PlayerName}", 1),
				occurrence("K90", "Only in the asset", 2),
				{
					...occurrence("", "Invariant", 3),
					identity: {
						status: "unresolved" as const,
						reason: "culture_invariant" as const
					}
				}
			]);
			yield* Effect.gen(function* () {
				const result = yield* (yield* GameTextIndexRefresh).refresh(fixture.request);
				const join = result.localizationJoin;
				const line = join.lines.find((item) => item.identity?.key === "K02")!;
				const review = Schema.decodeUnknownSync(LocalizationReviewFile)({
					schemaVersion: 1,
					target: join.target,
					records: [],
					acceptedFindings: [
						{
							check: "localization.whitespace",
							culture: "de",
							namespace: "UI",
							key: "K02",
							fingerprint: localizationLineFingerprint(
								line,
								line.cultures.find((culture) => culture.culture === "de")!
							),
							by: "Reviewer",
							at: "2026-10-14T00:00:00Z"
						},
						{
							check: "localization.rich_text",
							culture: "de",
							namespace: "UI",
							key: "K01",
							fingerprint: "0".repeat(64),
							by: "Reviewer",
							at: "2026-10-14T00:00:00Z"
						}
					]
				});
				const whitespace: number[] = [];
				for (const options of [{}, { review }]) {
					const source = evaluateGameTextSourceQuality(result.corpus, document);
					const legacy = localizationQualityWorkspace(
						source,
						checkLocalizationTarget(
							result.corpus,
							join,
							result.evidence,
							options,
							document
						),
						join
					);
					const indexed = localizationQualityWorkspaceOf(
						source,
						result.localizationQuality!(options, document)
					);
					const all = legacy.search({ target: join.target, filter: "all" });
					for (const filter of WorkspaceQualityFilter.literals)
						expect([filter, all.counts[filter]]).not.toEqual([filter, 0]);
					expect(all.suggestedFixCount).toBeGreaterThan(0);
					whitespace.push(all.counts.whitespace);
					for (const culture of [undefined, ...join.cultures])
						for (const filter of WorkspaceQualityFilter.literals) {
							const request: WorkspaceQualityRequest = {
								target: join.target,
								filter,
								...(culture ? { culture } : undefined)
							};
							for (const offset of [0, 50])
								expect(indexed.search({ ...request, offset })).toEqual(
									legacy.search({ ...request, offset })
								);
							expect(indexed.export(request)).toEqual(legacy.export(request));
							expect(indexed.changes(request)).toEqual(legacy.changes(request));
							// Every finding once; later occurrence pages for a sample.
							if (filter !== "all" || culture) continue;
							legacy.export(request).findings.forEach(({ id }, index) => {
								for (const occurrenceOffset of index % 10 === 0 ? [0, 1] : [0])
									expect(
										indexed.focus({ ...request, id, occurrenceOffset })
									).toEqual(legacy.focus({ ...request, id, occurrenceOffset }));
							});
						}
					const unknown = TextQualityFindingId.make(
						all.findings[0]!.id.replace(/.$/u, "x")
					);
					expect(indexed.focus({ target: join.target, id: unknown })).toEqual({
						status: "not_found"
					});
				}
				// The current acceptance hides one finding; the stale one hides nothing.
				expect(whitespace[1]).toBe(whitespace[0]! - 1);
			}).pipe(Effect.provide(fixture.layer()));
		}).pipe(Effect.scoped),
	120_000
);
