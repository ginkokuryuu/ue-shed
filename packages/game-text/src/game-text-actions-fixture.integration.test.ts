import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assetReaderLayer, extractProjectTextPackages } from "@ue-shed/unreal-assets";
import { Effect, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { useSavedFixtureProject } from "../../../fixtures/unreal-project/saved-project.test-support.js";
import { textCorpusFromExtractionEvents } from "./corpus.js";
import { textCorpusQuery } from "./query.js";

const ROOT = "/Game/Fixture/GameTextActions/";
const ENGINES = ["5.7", "5.8"] as const;

const Place = Schema.Struct({ site: Schema.String, source: Schema.String });
const Cases = Schema.Struct({
	schemaVersion: Schema.Literal(1),
	target: Schema.Literal("GameTextActions"),
	cases: Schema.Array(
		Schema.Struct({
			case: Schema.String,
			a: Place,
			b: Place,
			id: Schema.Literals(["same", "different"]),
			packageNamespace: Schema.optionalKey(Schema.Literals(["same", "different"]))
		})
	),
	// Places Unreal gathers that the saved-package reader does not read yet, pinned so a change in
	// either direction is noticed.
	readerGaps: Schema.Array(Schema.Struct({ site: Schema.String, source: Schema.String }))
});
const Evidence = Schema.Struct({
	schemaVersion: Schema.Literal(1),
	target: Schema.Literal("GameTextActions"),
	engineVersion: Schema.String,
	packages: Schema.Array(
		Schema.Struct({
			package: Schema.String,
			packageNamespace: Schema.String,
			texts: Schema.Array(
				Schema.Struct({
					site: Schema.String,
					namespace: Schema.String,
					key: Schema.String,
					source: Schema.String,
					editorOnly: Schema.Boolean
				})
			)
		})
	)
});
type Evidence = typeof Evidence.Type;

const fixture = useSavedFixtureProject();
const executable = process.env.UE_SHED_UASSET_EXECUTABLE;

const readCases = async () =>
	Schema.decodeUnknownSync(Schema.fromJsonString(Cases))(
		await readFile(
			join(fixture.root, "FixtureSource/GameTextActions/expected-cases.json"),
			"utf8"
		)
	);

const readEvidence = async (engine: (typeof ENGINES)[number]) =>
	Schema.decodeUnknownSync(Schema.fromJsonString(Evidence))(
		await readFile(
			join(fixture.root, `FixtureExpected/game-text-actions/evidence.ue${engine}.json`),
			"utf8"
		)
	);

/** Unreal's gather records for one place: its site and source, by gathered (runtime) text first. */
function place(evidence: Evidence, wanted: typeof Place.Type) {
	const site = ROOT + wanted.site;
	const packageName = site.slice(0, site.indexOf("."));
	const entry = evidence.packages.find((item) => item.package === packageName);
	const texts = entry?.texts.filter(
		(text) => text.site === site && text.source === wanted.source
	);
	const text = texts?.find((item) => !item.editorOnly) ?? texts?.[0];
	if (!entry || !text) throw new Error(`No gathered text at ${wanted.site}: ${wanted.source}`);
	return { ...text, packageNamespace: entry.packageNamespace };
}

/** Unreal's conflict report: one block per id, listing each place and its source. */
function conflicts(report: string) {
	return report
		.replaceAll("\r\n", "\n")
		.split("\n\n")
		.map((block) => block.trim())
		.filter(Boolean)
		.map((block) => {
			const [id, ...places] = block.split("\n");
			return {
				// "Namespace - Key"; typed text has an empty namespace.
				key: id!.replace(/^(?:.* )?- /u, "").trim(),
				places: places
					.map((line) =>
						line
							.trim()
							.replace(/ - ".*$/u, "")
							.replace(ROOT, "")
					)
					.sort()
			};
		})
		.sort((left, right) => left.key.localeCompare(right.key));
}

describe("Game Text identity cases in the saved fixture", () => {
	it.each(ENGINES)("records what UE %s did to each id", async (engine) => {
		const cases = await readCases();
		const evidence = await readEvidence(engine);
		expect(evidence.engineVersion).toBe(engine);

		// Typed text never has a user namespace: Unreal keys it with a GUID inside its package's
		// localization namespace, and the gather strips that namespace from the id.
		for (const entry of evidence.packages) {
			expect(entry.packageNamespace).toMatch(/^[0-9A-F]{32}$/u);
			for (const text of entry.texts.filter((item) => !item.site.includes(".SCS_Node_")))
				expect([text.namespace, text.key]).toEqual([
					"",
					expect.stringMatching(/^[0-9A-F]{32}$/u)
				]);
		}

		// Every mismatch is listed at once.
		expect(
			cases.cases.flatMap((item) => {
				const a = place(evidence, item.a);
				const b = place(evidence, item.b);
				const id = a.namespace === b.namespace && a.key === b.key ? "same" : "different";
				const packageNamespace =
					a.packageNamespace === b.packageNamespace ? "same" : "different";
				return id === item.id &&
					(item.packageNamespace ?? packageNamespace) === packageNamespace
					? []
					: [{ case: item.case, id, packageNamespace }];
			})
		).toEqual([]);
	});

	it("matches Unreal's conflict report: one id, different text, only across branch copies", async () => {
		const cases = await readCases();
		const evidence = await readEvidence("5.7");
		const report = await readFile(
			join(
				fixture.root,
				"Content/Localization/GameTextActions/GameTextActions_Conflicts.txt"
			),
			"utf8"
		);
		const expected = cases.cases
			.filter((item) => item.id === "same" && item.a.source !== item.b.source)
			.map((item) => ({
				key: place(evidence, item.a).key,
				places: [item.a.site, item.b.site].sort()
			}))
			.sort((left, right) => left.key.localeCompare(right.key));
		expect(conflicts(report)).toEqual(expected);
	});

	it.skipIf(!executable)(
		"reads the id and source Unreal gathers from every place an action edits",
		async () => {
			const cases = await readCases();
			const evidence = await readEvidence("5.7");
			const corpus = textCorpusFromExtractionEvents({
				projectRoot: fixture.root,
				events: await Effect.runPromise(
					Stream.runCollect(
						extractProjectTextPackages({ projectRoot: fixture.root })
					).pipe(Effect.provide(assetReaderLayer({ executable: executable! })))
				)
			});
			const fromReader = new Set<string>();
			for (const unit of corpus.units)
				for (const occurrence of unit.occurrences) {
					if (occurrence.identity.status !== "resolved") continue;
					const packageName = `/Game/${occurrence.packageFile
						.replaceAll("\\", "/")
						.replace(/^Content\//u, "")
						.replace(/\.uasset$/u, "")}`;
					if (!packageName.startsWith(ROOT)) continue;
					for (const source of [
						occurrence.source,
						...(occurrence.copies ?? []).map((copy) => copy.source)
					])
						fromReader.add(
							JSON.stringify([packageName, occurrence.identity.key, source])
						);
				}
			// Each runtime text Unreal gathers, by site, that the reader has no matching id and source for.
			const missing = evidence.packages.flatMap((entry) =>
				entry.texts
					.filter(
						(text) =>
							!text.editorOnly &&
							!fromReader.has(JSON.stringify([entry.package, text.key, text.source]))
					)
					.map((text) => ({ site: text.site.replace(ROOT, ""), source: text.source }))
			);
			const key = (item: typeof Place.Type) => JSON.stringify([item.site, item.source]);
			expect([...new Set(missing.map(key))].sort()).toEqual(cases.readerGaps.map(key).sort());
		}
	);

	it.skipIf(!executable)(
		"keeps two keys with the same text in one compiled function apart",
		async () => {
			// The duplicated Blueprint's ubergraph prints "The door is locked" under two keys: the
			// Content Browser duplicate re-keyed the original node but not its pasted copy.
			const corpus = textCorpusFromExtractionEvents({
				projectRoot: fixture.root,
				events: await Effect.runPromise(
					Stream.runCollect(
						extractProjectTextPackages({
							projectRoot: fixture.root,
							paths: [
								join(
									fixture.root,
									"Content/Fixture/GameTextActions/BP_ActionSign_Duplicate.uasset"
								)
							]
						})
					).pipe(Effect.provide(assetReaderLayer({ executable: executable! })))
				)
			});
			const locked = corpus.units.flatMap((unit) =>
				unit.occurrences.filter(
					(occurrence) =>
						occurrence.source === "The door is locked" &&
						occurrence.location.kind === "asset_property" &&
						occurrence.location.propertyPath.startsWith("ScriptBytecode")
				)
			);
			expect(new Set(locked.map((occurrence) => occurrence.id)).size).toBe(2);
			expect(
				textCorpusQuery(corpus).search({
					capability: "all",
					lens: "duplicate_source",
					pageSize: 50,
					query: "The door is locked"
				}).units
			).toHaveLength(2);
		}
	);
});
