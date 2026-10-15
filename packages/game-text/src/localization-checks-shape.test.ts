import { Schema } from "effect";
import { parsePO } from "@ue-shed/localization/browser";
import { describe, expect, it } from "vitest";
import {
	archiveEntry,
	corpus,
	cultureCode,
	evidence,
	ftextUnit,
	manifestEntry,
	success,
	unit
} from "./localization.test-support.js";
import { joinLocalizationTarget } from "./localization.js";
import { checkLocalizationTarget } from "./localization-checks.js";
import { checkSeverity } from "./localization-check-ids.js";
import {
	type LocalizationCheckOptions,
	type LocalizationQualityFinding,
	LocalizationQualityReport
} from "./localization-quality-schema.js";
import {
	compareRichTextTags,
	interiorLineBreaks,
	lengthOutlier,
	lengthOutlierMinimumRatio,
	numberOnlyText,
	placeholderMatches,
	placeholderTranslation,
	richTextTagBalance,
	sourceWhitespace,
	translationGroupKey,
	visibleTextLength
} from "./localization-text-shape.js";
import {
	WorkspaceQualityPage,
	localizationQualityWorkspace,
	workspaceQualityCsv
} from "./localization-workspace.js";
import { STARTER_GAME_TEXT_RULES } from "./starter-rules.js";
import { TextQualityRuleDocument } from "./quality-schema.js";
import { TextUnit, type TextCorpus } from "./schema.js";

const noPO = () => success(parsePO(new TextEncoder().encode("")));
const provenance = {
	relativePath: "Content/Localization/Test",
	size: 1,
	modifiedTime: "2026-01-01T00:00:00Z",
	contentHash: "hash"
};

function report(
	text: TextCorpus,
	files: ReturnType<typeof evidence>,
	options: LocalizationCheckOptions = {},
	rules?: TextQualityRuleDocument
) {
	const joined = joinLocalizationTarget(text, files, files.target);
	return {
		joined,
		report: checkLocalizationTarget(text, joined, files, options, rules)
	};
}

/** One gathered line with the same archive translation in every culture. */
function line(
	source: string,
	translation: string,
	options: LocalizationCheckOptions = {},
	rules?: TextQualityRuleDocument
) {
	const text = corpus([unit("K", source)]);
	return report(
		text,
		evidence([manifestEntry("K", source)], [archiveEntry("K", source, translation)], noPO()),
		options,
		rules
	).report;
}

const rules = (fields: Partial<TextQualityRuleDocument>) =>
	Schema.decodeUnknownSync(TextQualityRuleDocument)({ ...STARTER_GAME_TEXT_RULES, ...fields });

/** The kinds a line's German translation gets. */
const kinds = (value: LocalizationQualityReport) =>
	findings(value)
		.filter((finding) => finding.culture === "de")
		.map((finding) => finding.kind);

function findings(value: LocalizationQualityReport): readonly LocalizationQualityFinding[] {
	return value.findings.filter(
		(finding): finding is LocalizationQualityFinding => "culture" in finding
	);
}
function kind<K extends LocalizationQualityFinding["kind"]>(
	value: LocalizationQualityReport,
	wanted: K,
	culture?: string
) {
	return findings(value).filter(
		(finding): finding is Extract<LocalizationQualityFinding, { kind: K }> =>
			finding.kind === wanted && (culture === undefined || finding.culture === culture)
	);
}

/** A second saved unit for an existing key, in another asset. */
function another(key: string, source: string, objectPath: string): TextUnit {
	const base = unit(key, source);
	return Schema.decodeUnknownSync(TextUnit)({
		...base,
		id: `unit:${key}:${objectPath}`,
		occurrences: base.occurrences.map((occurrence) => ({
			...occurrence,
			id: `occurrence:${key}:${objectPath}`,
			location: { ...occurrence.location, objectPath }
		}))
	});
}

describe("text shape helpers", () => {
	it("compares rich-text tags by name and case", () => {
		expect(
			compareRichTextTags('Press <Key>Space</> or <img id="pad"/>', "Leertaste drücken")
		).toMatchObject({ missing: ["Key", "img"], added: [], changed: [] });
		expect(compareRichTextTags("<Italic>Note</>", "<italic>Hinweis</>")).toMatchObject({
			missing: [],
			added: [],
			changed: [{ source: "Italic", translation: "italic" }]
		});
		expect(compareRichTextTags("a < b > c", "a < b > c")).toBeUndefined();
		expect(compareRichTextTags("Plain", "Schlicht")).toBeUndefined();
	});
	it("measures visible length and flags only clear outliers", () => {
		expect(visibleTextLength("<b>Hi</> {Name}|plural(one=x,other=y)  there")).toBe(8);
		// Whitespace runs, non-breaking spaces included, count once; ends do not count.
		expect(visibleTextLength("  a  \tb \n")).toBe(3);
		// A supplementary-plane ideograph is one wide code point.
		expect(visibleTextLength("\u{20000}x")).toBe(3);
		// Wide characters count twice, so a Chinese translation of similar meaning is no outlier.
		expect(
			lengthOutlier("Open the inventory to see items", "打开背包查看物品")
		).toBeUndefined();
		expect(lengthOutlier("A fairly long sentence about the harbour", "Hafen")).toEqual({
			length: 5,
			sourceLength: 40,
			ratio: 0.13
		});
		expect(lengthOutlier("Short source", "Eine sehr viel längere Übersetzung")).toBeUndefined();
		// Chinese, Japanese, Korean and Thai may run down to a quarter of the source.
		expect(["zh-CN", "ja", "ko", "th-TH", "de", "id"].map(lengthOutlierMinimumRatio)).toEqual([
			0.25,
			0.25,
			0.25,
			0.25,
			1 / 3,
			1 / 3
		]);
	});
	it("recognizes placeholder translations, Slate tag syntax and interior line breaks", () => {
		const source = "The rows are like a composition.//You left negative space. On purpose?";
		expect(
			["script lama", "Skip", "...", ".", "…", "-", "TBD"].map((text) =>
				placeholderTranslation(source, text)
			)
		).toEqual(["script lama", "Skip", "...", ".", "…", "-", "TBD"]);
		expect(
			placeholderTranslation(source, "Las filas son como una composición.")
		).toBeUndefined();
		expect(placeholderTranslation("...", "...")).toBeUndefined();
		expect(placeholderTranslation("Okay", "OK")).toBeUndefined();
		// Slate attributes are name="value" pairs; "<invalid requirement type>" is text.
		expect(richTextTagBalance("<invalid requirement type>")).toEqual({
			opening: 0,
			closing: 0,
			xmlClosings: []
		});
		expect(
			richTextTagBalance("GetWorld()->GetGameInstance()->GetSubsystem<UC_InputSubsystem>()")
		).toMatchObject({ opening: 0, closing: 0 });
		expect(richTextTagBalance("<{playerColor}>{playerName}</>")).toMatchObject({
			opening: 1,
			closing: 1
		});
		expect(
			richTextTagBalance(
				"To join the festival, arrive between <timeAnd>19:00 and 22:00</timeAnd>."
			)
		).toEqual({ opening: 1, closing: 0, xmlClosings: ["timeAnd"] });
		expect(interiorLineBreaks("\r\n<PlayerName>{ParentLabel}</>，为什么？")).toBe(0);
		expect(interiorLineBreaks("Tu madre.\r\n")).toBe(0);
		expect(interiorLineBreaks("Torn Pages\r\nA scrap\nof paper")).toBe(2);
		expect(
			["thanks", "Danke!", " danke ", "Karte  öffnen.", "..."].map(translationGroupKey)
		).toEqual(["thanks", "danke", "danke", "karteöffnen", "..."]);
	});
	it("finds placeholders, number-only text and source whitespace", () => {
		expect(placeholderMatches("TODO: name, Lorem ipsum, To be translated")).toEqual([
			"TODO",
			"Lorem ipsum",
			"To be translated"
		]);
		// "todo" is Spanish and Portuguese for "all".
		expect(placeholderMatches("todo el mundo")).toEqual([]);
		expect(["100", "3/4", "+25%", "1,000"].map(numberOnlyText)).toEqual([
			true,
			true,
			true,
			true
		]);
		expect(["Level 5", "{0}%", "---", ""].map(numberOnlyText)).toEqual([
			false,
			false,
			false,
			false
		]);
		expect(sourceWhitespace(" Score:  10 ")).toEqual({
			leading: " ",
			trailing: " ",
			repeatedSpaces: 1
		});
	});
});

describe("translation shape checks", () => {
	it("splits renamed arguments from dropped and added ones", () => {
		const value = line("{Count} of {Item} for {Owner}", "{Anzahl} von {Item}", {
			culture: cultureCode("de")
		});
		expect(kind(value, "format_argument_renamed")[0]?.actual.renamed).toEqual([
			{ from: "Anzahl", to: "Count" }
		]);
		expect(kind(value, "format_arguments")[0]?.actual).toMatchObject({
			missing: ["Owner"],
			added: []
		});
		// A rename plus a drop stages no change: the fix is not one rename.
		expect(value.changes.changes).toEqual([]);
	});
	it("reports missing, added and case-changed rich-text tags", () => {
		const tags = line("Press <Key>Space</> now", "Leertaste <b>jetzt</> drücken");
		expect(kind(tags, "rich_text_tags", "de")[0]?.actual).toEqual({
			tags: ["b"],
			missing: ["Key"],
			added: ["b"]
		});
		expect(kind(tags, "rich_text_tags_added")).toEqual([]);
		// Added tags alone are low: they style more text, but drop nothing.
		const added = line(
			"I should've brought little Stephen.",
			"Eu devia ter trazido o pequeno <NPCName>Stephen</>."
		);
		expect(kind(added, "rich_text_tags")).toEqual([]);
		expect(
			kind(added, "rich_text_tags_added", "de").map((finding) => [
				finding.actual.added,
				finding.severity
			])
		).toEqual([[["NPCName"], "low"]]);
		// A missing image stays normal.
		expect(
			kind(
				line('Press <img id="pad"/> to jump', "Zum Springen drücken"),
				"rich_text_tags",
				"de"
			)[0]?.severity
		).toBe("normal");
		const cased = line("<Italic>Note</>", "<italic>Hinweis</>");
		expect(kind(cased, "rich_text_tag_case", "de")[0]?.actual.changed).toEqual([
			{ source: "Italic", translation: "italic" }
		]);
		expect(kind(cased, "rich_text_tag_case", "de")[0]?.severity).toBe("low");
		expect(kind(cased, "rich_text_tags")).toEqual([]);
	});
	it("reports line breaks apart from edge whitespace", () => {
		const breaks = line("Hello\nWorld", "Hallo Welt");
		expect(kind(breaks, "line_breaks", "de")[0]).toMatchObject({
			actual: { lineBreaks: 0 },
			expectation: { lineBreaks: 1 }
		});
		expect(kind(breaks, "whitespace", "de")).toEqual([]);
		expect(kind(line("Hello", " Hallo"), "whitespace", "de")).toHaveLength(1);
		// Breaks at the ends are the whitespace check's; only interior breaks count here.
		const edges = line(
			"Your mom might not be perfect, but she's still yours.",
			"Tu madre no será perfecta, pero sigue siendo tu madre.\r\n"
		);
		expect(kind(edges, "line_breaks")).toEqual([]);
		expect(kind(edges, "whitespace", "de")).toHaveLength(1);
		expect(kind(line("Torn Pages\nA scrap", "Seiten\r\nEin Fetzen"), "line_breaks")).toEqual(
			[]
		);
	});
	it("leaves empty translations to empty_translation", () => {
		const empty = line(
			"<NPCName>{BabyName1}</> has a tail.//Okay, that's {Count}|plural(one=one,other=many) cool.\nYes",
			"",
			{},
			rules({ segmentSeparator: "//" })
		);
		expect(kinds(empty)).toEqual(["empty_translation"]);
		// A translation that is only whitespace is empty for the shape checks too.
		expect(
			kinds(line("<b>Bold</> {Name}\nnext line", "  ")).filter(
				(found) => found !== "whitespace"
			)
		).toEqual([]);
	});
	it("lets a translation add optional arguments, their tags and optional tags", () => {
		const optional = rules({ optionalArguments: ["ParentLabel"], optionalTags: ["italic"] });
		const added = "<PlayerName>{ParentLabel}</>, cookie! Yummy nummy!";
		expect(kinds(line("Cookie! Yummy nummy!", added))).toEqual(
			expect.arrayContaining(["format_arguments", "rich_text_tags_added"])
		);
		expect(kinds(line("Cookie! Yummy nummy!", added, {}, optional))).toEqual([]);
		// Dropping a source's optional argument is still reported.
		expect(
			kinds(line("<PlayerName>{ParentLabel}</>, cookie!", "Keks!", {}, optional))
		).toContain("format_arguments");
		// An optional argument never pairs with a dropped one as a rename.
		const renamed = line("Hi {BabyNameAuto}", "Hallo {BabyName1} {ParentLabel}", {}, optional);
		expect(kind(renamed, "format_argument_renamed", "de")[0]?.actual.renamed).toEqual([
			{ from: "BabyName1", to: "BabyNameAuto" }
		]);
		expect(kind(renamed, "format_arguments")).toEqual([]);
		// Optional tags may be added or left out.
		expect(kinds(line("A <Italic>note</> here", "Eine Notiz hier", {}, optional))).toEqual([]);
		expect(kinds(line("A note here", "Eine <Italic>Notiz</> hier", {}, optional))).toEqual([]);
	});
	it("checks the rule file's segment separator only when it names one", () => {
		const text = corpus([unit("K", "Yes // No")]);
		const files = evidence(
			[manifestEntry("K", "Yes // No")],
			[archiveEntry("K", "Yes // No", "Ja Nein")],
			noPO()
		);
		expect(kind(report(text, files).report, "segment_separator")).toEqual([]);
		const rules = Schema.decodeUnknownSync(TextQualityRuleDocument)({
			...STARTER_GAME_TEXT_RULES,
			segmentSeparator: "//"
		});
		const checked = report(text, files, {}, rules).report;
		expect(kind(checked, "segment_separator", "de")[0]).toMatchObject({
			actual: { separator: "//", count: 0 },
			expectation: { separator: "//", count: 1 }
		});
		expect(checked.rules.map((rule) => rule.ruleId)).toContain(
			"localization.segment_separator"
		);
	});
	it("flags translations of a different length and keeps wide scripts in range", () => {
		expect(
			kind(line("A fairly long sentence about the harbour", "Hafen"), "length_outlier", "de")
		).toHaveLength(1);
		expect(
			kind(line("Open the inventory to see items", "打开背包查看物品"), "length_outlier")
		).toEqual([]);
		// A translation at 0.3 of its source is in range for Thai, not for German.
		const source = "If you want to head here fast, make offerings";
		const short = "ถ้ามาเร็วถวาย";
		const ratio = visibleTextLength(short) / visibleTextLength(source);
		expect(ratio).toBeGreaterThan(0.25);
		expect(ratio).toBeLessThan(1 / 3);
		expect(
			lengthOutlier(source, short, undefined, lengthOutlierMinimumRatio("th-TH"))
		).toBeUndefined();
		expect(lengthOutlier(source, short, undefined, lengthOutlierMinimumRatio("de"))).toEqual({
			length: 13,
			sourceLength: 45,
			ratio: 0.29
		});
	});
	it("reports placeholder translations instead of their length", () => {
		const value = line(
			"The rows are like a composition.//You left negative space. On purpose?",
			"script lama"
		);
		expect(kind(value, "placeholder_translation", "de")[0]?.actual).toEqual({
			translation: "script lama"
		});
		expect(kind(value, "length_outlier")).toEqual([]);
		expect(kinds(line("Your spouse checks the supplies.", "..."))).toContain(
			"placeholder_translation"
		);
	});
	it("reports a translation made for older source as blocking, never for the native culture", () => {
		const text = corpus([unit("K", "Open the door")]);
		const files = evidence(
			[manifestEntry("K", "Open the door")],
			[archiveEntry("K", "Open the gate", "Öffne das Tor")],
			noPO()
		);
		const outdated = kind(report(text, files).report, "outdated_translation");
		expect(outdated.map((finding) => [finding.culture, finding.severity])).toEqual([
			["de", "blocking"]
		]);
		expect(outdated[0]).toMatchObject({
			actual: { translatedSource: "Open the gate" },
			expectation: { source: "Open the door" }
		});
	});
	it("reports a source that changed only its line endings as low, apart from outdated text", () => {
		const current = "Torn Pages\nA scrap of paper. Whispers from the everyday.";
		const recorded = "Torn Pages\r\nA scrap of paper. Whispers from the everyday.";
		const text = corpus([unit("K", current)]);
		const files = evidence(
			[manifestEntry("K", current)],
			[
				archiveEntry(
					"K",
					recorded,
					"Halaman-halaman Robek\r\nSecarik kertas. Cuplikan kehidupan sehari-hari."
				)
			],
			noPO()
		);
		const value = report(text, files).report;
		expect(kind(value, "outdated_translation")).toEqual([]);
		expect(
			kind(value, "source_line_endings_changed").map((finding) => [
				finding.culture,
				finding.severity,
				finding.actual.translatedSource
			])
		).toEqual([["de", "low", recorded]]);
		// An empty translation of older text is only empty_translation's.
		const empty = report(
			corpus([unit("K", "Everything is perfectly fine.")]),
			evidence(
				[manifestEntry("K", "Everything is perfectly fine.")],
				[archiveEntry("K", "Everything is fine.", "")],
				noPO()
			)
		).report;
		expect(kinds(empty)).toEqual(["empty_translation"]);
	});
	it("reports empty archive entries of keys a partly read package did not yield", () => {
		const text = {
			...corpus([]),
			packageCoverage: [
				{ packageFile: "Content/Text/Table.uasset", status: "partial" as const }
			]
		};
		const files = evidence([manifestEntry("K", "Source")], [archiveEntry("K", "Source", "")]);
		const { joined, report: value } = report(text, files);
		expect(joined.lines[0]?.cultures[1]?.unknownReasons).toContain("package_partial");
		expect(kind(value, "empty_translation", "de")).toHaveLength(1);
	});
	it("reports empty archive entries when a partly read package left the saved text blank", () => {
		const text = corpus([unit("K", "")]);
		const files = evidence([manifestEntry("K", "Source")], [archiveEntry("K", "Source", "")]);
		expect(kind(report(text, files).report, "empty_translation", "de")).toHaveLength(1);
	});
});

describe("translated inconsistently", () => {
	const shared = (translations: readonly string[], source = "Open the map") => {
		const keys = translations.map((_, index) => `K${index}`);
		const text = corpus(keys.map((key) => unit(key, source)));
		return report(
			text,
			evidence(
				keys.map((key) => manifestEntry(key, source)),
				keys.map((key, index) => archiveEntry(key, source, translations[index]!)),
				noPO()
			),
			{ culture: cultureCode("de") }
		).report;
	};
	it("reports the keys that leave the culture's usual translation", () => {
		const value = kind(
			shared(["Karte öffnen", "Karte öffnen", "Karte zeigen"]),
			"inconsistent_translation"
		);
		expect(value.map((finding) => finding.identity?.key)).toEqual(["K2"]);
		expect(value[0]?.actual).toEqual({
			translation: "Karte zeigen",
			variants: [
				{ translation: "Karte öffnen", lines: 2 },
				{ translation: "Karte zeigen", lines: 1 }
			],
			variantCount: 2
		});
	});
	it("skips ties, sentences, short or number-only text and the native culture", () => {
		expect(kind(shared(["Karte öffnen", "Karte zeigen"]), "inconsistent_translation")).toEqual(
			[]
		);
		expect(kind(shared(["Ja", "Jawohl"], "OK"), "inconsistent_translation")).toEqual([]);
		expect(kind(shared(["100", "1.000"], "100"), "inconsistent_translation")).toEqual([]);
		// More than four words: sentences are often worded to fit their scene.
		expect(
			kind(
				shared(
					["Gern geschehen, Kleiner.", "Gern geschehen, Kleiner.", "Kein Problem, Kind."],
					"No problem at all, kiddo."
				),
				"inconsistent_translation"
			)
		).toEqual([]);
		// The native culture's "translations" are its source text, edited or not.
		const keys = ["K0", "K1", "K2"];
		const files = evidence(
			keys.map((key) => manifestEntry(key, "Milk")),
			[],
			noPO()
		);
		const native = report(corpus(keys.map((key) => unit(key, "Milk"))), {
			...files,
			cultures: files.cultures.map((culture) => ({
				...culture,
				archive: {
					status: "read" as const,
					provenance: { ...provenance, relativePath: culture.culture },
					value: {
						formatVersion: 2,
						diagnostics: [],
						entries: keys.map((key, index) =>
							archiveEntry(
								key,
								"Milk",
								culture.culture === "en" ? (index ? "Milk" : "Fresh milk") : "Milch"
							)
						)
					}
				}
			}))
		}).report;
		expect(kind(native, "inconsistent_translation")).toEqual([]);
	});
	it("groups translations without case, whitespace and punctuation", () => {
		expect(
			kind(shared(["danke!", "Danke", "danke "], "thanks"), "inconsistent_translation")
		).toEqual([]);
		const value = kind(
			shared(["Danke!", "danke", "Vielen Dank"], "thanks"),
			"inconsistent_translation"
		);
		expect(value.map((finding) => finding.identity?.key)).toEqual(["K2"]);
		expect(value[0]?.actual.variants).toEqual([
			{ translation: "Danke!", lines: 2 },
			{ translation: "Vielen Dank", lines: 1 }
		]);
	});
	it("reports the untranslated lines when most lines ship the source", () => {
		const value = kind(
			shared(["Yellowtail", "Yellowtail", "Gelbschwanz"], "Yellowtail"),
			"inconsistent_translation"
		);
		expect(
			value.map((finding) => [finding.identity?.key, finding.actual.untranslated])
		).toEqual([
			["K0", true],
			["K1", true]
		]);
		// An untranslated line among translated ones is marked too.
		expect(
			kind(
				shared(["Gelbschwanz", "Gelbschwanz", "Yellowtail"], "Yellowtail"),
				"inconsistent_translation"
			).map((finding) => [finding.identity?.key, finding.actual.untranslated])
		).toEqual([["K2", true]]);
	});
});

describe("built-in source checks", () => {
	it("check source text without a rule file, once per line under the native culture", () => {
		const checked = line(" TODO:  name ", "TODO: Name");
		expect(kind(checked, "placeholder_text").map((finding) => finding.culture)).toEqual(["en"]);
		expect(kind(checked, "source_whitespace")[0]?.actual).toEqual({
			source: " TODO:  name ",
			leading: " ",
			trailing: " ",
			repeatedSpaces: 1
		});
		expect(kind(line("Unclosed <Em>tag {Name", "x"), "source_markup")[0]?.actual).toEqual({
			source: "Unclosed <Em>tag {Name",
			richText: { opening: 1, closing: 0 },
			braces: { opening: 1, closing: 0 }
		});
		expect(kind(checked, "source_whitespace")[0]?.severity).toBe("low");
		expect(kind(line("100", "100"), "number_only_text")[0]?.severity).toBe("low");
		expect(kind(line("Level 5", "Stufe 5"), "number_only_text")).toEqual([]);
		expect(
			kind(line("TODO", "TODO", { culture: cultureCode("de") }), "placeholder_text")
		).toEqual([]);
	});
	it("checks source markup the way Slate reads it", () => {
		const markup = (source: string) => kind(line(source, source), "source_markup");
		expect(markup("<{playerColor}>{playerName}</>")).toEqual([]);
		expect(markup("<invalid requirement type>")).toEqual([]);
		expect(markup("GetWorld()->GetGameInstance()->GetSubsystem<UC_InputSubsystem>()")).toEqual(
			[]
		);
		expect(
			markup(
				"<NPCName>Valentina</> said <NPCName>Macy got this incredible new video game."
			).map((finding) => finding.actual.richText)
		).toEqual([{ opening: 2, closing: 1 }]);
		const workspace = (source: string) => {
			const text = corpus([unit("K", source)]);
			const files = evidence(
				[manifestEntry("K", source)],
				[archiveEntry("K", source, source)],
				noPO()
			);
			const { joined, report: value } = report(text, files);
			return localizationQualityWorkspace(undefined, value, joined).search({
				target: joined.target,
				filter: "source_markup"
			}).findings;
		};
		expect(
			workspace(
				"To join the festival, arrive between <timeAnd>19:00 and 22:00</timeAnd>."
			).map((finding) => finding.problem)
		).toEqual(["en · Closes with </timeAnd>; rich text closes with </>"]);
	});
	it("skips bytecode fragments and ungathered lines in the source checks", () => {
		const fragment = "Charles: I'm about ";
		const text = corpus([]);
		const files = evidence(
			[
				{
					...manifestEntry("K", fragment),
					path: "/Game/Cutscene/Heart_10.SequenceDirector_C:SequenceEvent__ENTRYPOINTSequenceDirector_4 [Script Bytecode]"
				},
				{
					...manifestEntry("N", "> 75"),
					path: "/Game/Cutscene/Heart_10.SequenceDirector_C:SequenceEvent_1 [Script Bytecode]"
				}
			],
			[archiveEntry("K", fragment, fragment), archiveEntry("N", "> 75", "> 75")],
			noPO()
		);
		const value = report(text, files).report;
		expect(kind(value, "source_whitespace")).toEqual([]);
		expect(kind(value, "number_only_text")).toEqual([]);
		const ungathered = report(
			corpus([unit("K", "For my birthday? Eww.\t")]),
			evidence([], [], noPO())
		).report;
		expect(kind(ungathered, "source_whitespace")).toEqual([]);
	});
	it("reports culture-invariant text, low, only where its property is localizable elsewhere", () => {
		const invariantUnit = (
			id: string,
			source: string,
			location: Record<string, string>,
			audience?: string
		) => {
			const base = ftextUnit(id, source);
			return Schema.decodeUnknownSync(TextUnit)({
				...base,
				id: `unit:${id}`,
				identity: { status: "unresolved", reason: "culture_invariant" },
				occurrences: base.occurrences.map((occurrence) => ({
					...occurrence,
					id: `occurrence:${id}`,
					identity: { status: "unresolved", reason: "culture_invariant" },
					location: { ...occurrence.location, ...location },
					...(audience ? { audience, audienceReason: "editor_property" } : undefined)
				}))
			});
		};
		const textBlock = {
			objectPath: "/Game/UI/Shop/WBP_PotionStall.WBP_PotionStall_C.WidgetTree.BlessingText",
			classPath: "/Script/UMG.TextBlock",
			propertyPath: "Text"
		};
		const keyed = ftextUnit("Title", "Shop");
		const localized = TextUnit.make({
			...keyed,
			occurrences: keyed.occurrences.map((occurrence) => ({
				...occurrence,
				location: {
					...occurrence.location,
					...textBlock,
					objectPath: "/Game/UI/Title.Title"
				}
			}))
		});
		const units = [
			localized,
			invariantUnit("a", "Blessing Description", textBlock),
			// A property no keyed text uses: a credits column of backer names.
			invariantUnit("b", "Lizzie Jenkins", {
				kind: "data_table_cell",
				objectPath: "/Game/UI/Credit/DT_CreditBackers.DT_CreditBackers",
				row: "11860",
				propertyPath: "title"
			}),
			// Debug widgets and saves.
			invariantUnit("c", "Skip Teleport", {
				...textBlock,
				objectPath:
					"/Game/UI/Debug/WBP_NpcDebugPanel.WBP_NpcDebugPanel_C.WidgetTree.TextBlock_5"
			}),
			// Text renders placed in a level or a sequence.
			invariantUnit("d", "Betty Bird Feeder Spot", {
				objectPath:
					"/Game/Maps/Waypoints.Waypoints.PersistentLevel.C_AnimationWaypoint_198.Text",
				classPath: "/Script/Engine.TextRenderComponent",
				propertyPath: "Text"
			}),
			invariantUnit("e", "C : 1 N : 0 Distance : 792.288", {
				objectPath:
					"/Game/Cutscene/Heart_7.Heart_7.MovieScene_0.BP_Cutscene_Waypoint_1.TextComponent",
				classPath: "/Script/Engine.TextRenderComponent",
				propertyPath: "Text"
			}),
			// Editor text, by its audience.
			invariantUnit("f", "Cloak kawaii", { ...textBlock, propertyPath: "Text" }, "editor")
		];
		const value = report(
			corpus(units),
			evidence(
				[manifestEntry("Title", "Shop")],
				[archiveEntry("Title", "Shop", "Laden")],
				noPO()
			)
		).report;
		const found = kind(value, "culture_invariant_text");
		expect(
			found.map((finding) => [
				finding.actual.source,
				finding.identity,
				finding.culture,
				finding.severity
			])
		).toEqual([["Blessing Description", null, "en", "low"]]);
		expect(
			Schema.decodeUnknownSync(LocalizationQualityReport)(JSON.parse(JSON.stringify(value)))
		).toEqual(value);
	});
	it("reports a key two String Tables declare", () => {
		const text = corpus([
			unit("K", "Shared"),
			another("K", "Shared", "/Game/Text/Other.Other")
		]);
		const value = report(
			text,
			evidence(
				[manifestEntry("K", "Shared")],
				[archiveEntry("K", "Shared", "Geteilt")],
				noPO()
			)
		).report;
		expect(kind(value, "string_table_key_collision")[0]?.actual).toEqual({
			tables: ["/Game/Text/Other.Other", "/Game/Text/Table.Table"],
			tableCount: 2
		});
	});
	it("lists conflicting sources apart and never compares or groups their joined text", () => {
		const text = corpus([
			unit("K", "Start"),
			another("K", "Begin", "/Game/Text/Other.Other"),
			unit("L", "Start Begin")
		]);
		const files = evidence(
			[manifestEntry("L", "Start Begin")],
			[archiveEntry("K", "Start Begin", "{Wrong}"), archiveEntry("L", "Start Begin", "x")],
			noPO()
		);
		const { joined, report: value } = report(text, files);
		const conflicting = findings(value).filter((finding) => finding.identity?.key === "K");
		expect(conflicting.length).toBeGreaterThan(0);
		for (const finding of conflicting)
			expect(finding.sourceVariants).toEqual(["Begin", "Start"]);
		// Without a manifest there is no one source to compare the translation with.
		expect(conflicting.some((finding) => finding.kind === "format_arguments")).toBe(false);
		// The joined text "Start Begin" is not shared with key L.
		expect(kind(value, "duplicate_source")).toEqual([]);
		const workspace = localizationQualityWorkspace(undefined, value, joined);
		const page = workspace.search({ target: joined.target, filter: "all" });
		const summary = page.findings.find((finding) => finding.sourceVariants);
		expect(summary?.sourceVariants).toEqual(["Begin", "Start"]);
		expect(summary?.source).toBe("Begin");
	});
});

describe("severity", () => {
	it("rates every built-in check and lists blocking findings first", () => {
		expect(checkSeverity.culture_invariant_text).toBe("low");
		expect(checkSeverity.outdated_translation).toBe("blocking");
		expect(checkSeverity.source_line_endings_changed).toBe("low");
		expect(checkSeverity.duplicate_source).toBe("low");
		const text = corpus([unit("A", "Alpha"), unit("Z", "Zulu text")]);
		const files = evidence(
			[manifestEntry("A", "Alpha"), manifestEntry("Z", "Zulu text")],
			[archiveEntry("A", "Alpha", "Alfa "), archiveEntry("Z", "Old zulu", "Zulu")],
			noPO()
		);
		const { joined, report: value } = report(text, files);
		for (const finding of findings(value))
			expect(finding.severity).toBe(checkSeverity[finding.kind]);
		const workspace = localizationQualityWorkspace(undefined, value, joined);
		const page = workspace.search({ target: joined.target, filter: "all" });
		expect(Schema.decodeUnknownSync(WorkspaceQualityPage)(page)).toEqual(page);
		const severities = page.findings.map((finding) => finding.severity);
		expect(severities[0]).toBe("blocking");
		const rank = { blocking: 0, normal: 1, low: 2 };
		expect(severities.map((severity) => rank[severity])).toEqual(
			severities.map((severity) => rank[severity]).sort((a, b) => a - b)
		);
		expect(page.severityCounts).toEqual({
			blocking: severities.filter((severity) => severity === "blocking").length,
			normal: severities.filter((severity) => severity === "normal").length,
			low: severities.filter((severity) => severity === "low").length
		});
		// Offsets page through the same severity order.
		const second = workspace.search({ target: joined.target, filter: "all", offset: 1 });
		expect(second.findings.map((finding) => finding.id)).toEqual(
			page.findings.slice(1).map((finding) => finding.id)
		);
		const csv = workspaceQualityCsv(workspace.export({ target: joined.target, filter: "all" }));
		expect(csv.split("\r\n")[0]).toContain("Severity");
	});
});
