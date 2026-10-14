import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Schema } from "effect";
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

/** Writes the target's manifest, archives and PO files for these keys. */
async function writeLocalization(projectRoot: string, entries: typeof keys) {
	const manifest = {
		FormatVersion: 1,
		Namespace: "UI",
		Children: entries.map(({ key, source }, index) => ({
			Source: { Text: source },
			Keys: [{ Key: key, Path: `/Game/Text/Table.Table.Label${index}` }]
		}))
	};
	const archive = (culture: "en" | "de") => ({
		FormatVersion: 2,
		Namespace: "UI",
		Children: entries.map(({ key, source, de }) => ({
			Key: key,
			Source: { Text: source },
			Translation: { Text: culture === "en" ? source : de }
		}))
	});
	// German ships the escape from its archive: Unreal's PO import would unescape it.
	const portable = (culture: "en" | "de") =>
		entries
			.filter(({ source }) => culture === "en" || source !== "Line one")
			.map(
				({ key, source, de }) =>
					`msgctxt "UI,${key}"\nmsgid "${po(source)}"\nmsgstr "${po(culture === "en" ? source : de)}"\n`
			)
			.join("\n");
	await writeFile(join(projectRoot, "Review.manifest"), JSON.stringify(manifest));
	for (const culture of ["en", "de"] as const) {
		await writeFile(join(projectRoot, `${culture}.archive`), JSON.stringify(archive(culture)));
		await writeFile(join(projectRoot, `${culture}.po`), portable(culture));
	}
}

it.live(
	"indexed quality pages, focus and proposals equal the in-memory workspace",
	() =>
		Effect.gen(function* () {
			const fixture = yield* makeIndexRegressionFixture();
			yield* Effect.promise(() => writeLocalization(fixture.projectRoot, keys));
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
						yield* result.localizationQuality!(options, document)
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

it.live("the indexed scan yields between pages and stops when interrupted", () =>
	Effect.gen(function* () {
		const fixture = yield* makeIndexRegressionFixture();
		yield* Effect.gen(function* () {
			const result = yield* (yield* GameTextIndexRefresh).refresh(fixture.request);
			let turns = 0,
				done = false;
			const other = yield* Effect.forkChild(
				Effect.whileLoop({
					while: () => !done,
					body: () => Effect.sync(() => turns++).pipe(Effect.andThen(Effect.yieldNow)),
					step: () => undefined
				})
			);
			const quality = yield* result.localizationQuality!();
			done = true;
			yield* Fiber.join(other);
			expect(quality.findings.length).toBeGreaterThan(0);
			// Another fiber ran while the scan was in progress.
			expect(turns).toBeGreaterThan(1);
			const scan = yield* Effect.forkChild(result.localizationQuality!());
			yield* Fiber.interrupt(scan);
			const exit = yield* Fiber.await(scan);
			expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
		}).pipe(Effect.provide(fixture.layer()));
	}).pipe(Effect.scoped)
);

it.live("proposals past the first 100 count the rest without reading their lines", () =>
	Effect.gen(function* () {
		const fixture = yield* makeIndexRegressionFixture();
		const fixable = Array.from({ length: 130 }, (_, index) => ({
			key: `F${String(index).padStart(3, "0")}`,
			source: "Hello {PlayerName}",
			de: "Hallo {Name}"
		}));
		yield* Effect.promise(() => writeLocalization(fixture.projectRoot, fixable));
		fixture.update(fixable.map(({ key, source }, index) => occurrence(key, source, index)));
		yield* Effect.gen(function* () {
			const result = yield* (yield* GameTextIndexRefresh).refresh(fixture.request);
			const join = result.localizationJoin;
			const legacy = localizationQualityWorkspace(
				undefined,
				checkLocalizationTarget(result.corpus, join, result.evidence),
				join
			);
			const indexed = localizationQualityWorkspaceOf(
				undefined,
				yield* result.localizationQuality!()
			);
			for (const request of [
				{ target: join.target, filter: "all" as const },
				{
					target: join.target,
					filter: "format_arguments" as const,
					culture: join.cultures[1]!
				}
			]) {
				const proposed = indexed.changes(request);
				expect(proposed).toEqual(legacy.changes(request));
				expect(proposed.status === "ready" && proposed.document.changes.length).toBe(100);
				expect(proposed.status === "ready" && proposed.remaining).toBe(30);
			}
		}).pipe(Effect.provide(fixture.layer()));
	}).pipe(Effect.scoped)
);
