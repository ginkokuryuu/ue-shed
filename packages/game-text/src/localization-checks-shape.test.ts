import { Schema } from "effect";
import { parsePO } from "@ue-shed/localization/browser";
import { describe, expect, it } from "vitest";
import {
	archiveEntry,
	corpus,
	cultureCode,
	evidence,
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
	lengthOutlier,
	numberOnlyText,
	placeholderMatches,
	sourceWhitespace,
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
function line(source: string, translation: string, options: LocalizationCheckOptions = {}) {
	const text = corpus([unit("K", source)]);
	return report(
		text,
		evidence([manifestEntry("K", source)], [archiveEntry("K", source, translation)], noPO()),
		options
	).report;
}

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
	it("reports every key when no translation is the most used, and skips short or number-only text", () => {
		expect(
			kind(shared(["Karte öffnen", "Karte zeigen"]), "inconsistent_translation").map(
				(finding) => finding.identity?.key
			)
		).toEqual(["K0", "K1"]);
		expect(kind(shared(["Ja", "Jawohl"], "OK"), "inconsistent_translation")).toEqual([]);
		expect(kind(shared(["100", "1.000"], "100"), "inconsistent_translation")).toEqual([]);
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
		expect(kind(line("100", "100"), "number_only_text")[0]?.severity).toBe("low");
		expect(kind(line("Level 5", "Stufe 5"), "number_only_text")).toEqual([]);
		expect(
			kind(line("TODO", "TODO", { culture: cultureCode("de") }), "placeholder_text")
		).toEqual([]);
	});
	it("reports culture-invariant text with letters as blocking and without a key", () => {
		const base = unit("K", "Quest complete");
		const invariant = Schema.decodeUnknownSync(TextUnit)({
			...base,
			identity: { status: "unresolved", reason: "culture_invariant" },
			occurrences: base.occurrences.map((occurrence) => ({
				...occurrence,
				identity: { status: "unresolved", reason: "culture_invariant" }
			}))
		});
		const value = report(corpus([invariant]), evidence([], [], noPO())).report;
		const found = kind(value, "culture_invariant_text");
		expect(
			found.map((finding) => [finding.identity, finding.culture, finding.severity])
		).toEqual([[null, "en", "blocking"]]);
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
		expect(checkSeverity.culture_invariant_text).toBe("blocking");
		expect(checkSeverity.outdated_translation).toBe("blocking");
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
