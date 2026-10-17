import { Effect, Schema } from "effect";
import { parsePO } from "@ue-shed/localization/browser";
import { describe, expect, it } from "vitest";
import {
	archiveEntry,
	corpus,
	evidence,
	manifestEntry,
	success,
	unit
} from "./localization.test-support.js";
import { joinLocalizationTarget } from "./localization.js";
import { checkLocalizationTarget } from "./localization-checks.js";
import { localizationCheckDefaults } from "./localization-check-catalogue.js";
import type {
	LocalizationCheckOptions,
	LocalizationQualityFinding,
	LocalizationQualityReport
} from "./localization-quality-schema.js";
import { TextQualityRuleDocument } from "./quality-schema.js";
import {
	GameTextRuleDocument,
	TextQualityRuleDocumentV3,
	decodeGameTextRuleDocumentJson,
	migrateGameTextRuleDocument,
	resolveLocalizationChecks
} from "./game-text-rules.js";
import { STARTER_GAME_TEXT_RULES } from "./starter-rules.js";

const noPO = () => success(parsePO(new TextEncoder().encode("")));

/** One gathered line with the same archive translation in every culture. */
function line(
	source: string,
	translation: string,
	rules?: GameTextRuleDocument,
	options: LocalizationCheckOptions = {}
): LocalizationQualityReport {
	const text = corpus([unit("K", source)]);
	const files = evidence(
		[manifestEntry("K", source)],
		[archiveEntry("K", source, translation)],
		noPO()
	);
	const joined = joinLocalizationTarget(text, files, files.target);
	return checkLocalizationTarget(text, joined, files, options, rules);
}

const german = (value: LocalizationQualityReport) =>
	value.findings.filter(
		(finding): finding is LocalizationQualityFinding =>
			"culture" in finding && finding.culture === "de"
	);
const kinds = (value: LocalizationQualityReport) => german(value).map((finding) => finding.kind);

type V3Fields = Omit<typeof TextQualityRuleDocumentV3.Encoded, "schemaVersion" | "roles" | "rules">;
type V1Fields = Partial<typeof TextQualityRuleDocument.Encoded>;
/** A version-3 file's JSON with these fields, decoded as a host reads it. */
const decode = (fields: string) =>
	Effect.runSync(
		Effect.result(
			decodeGameTextRuleDocumentJson(
				`{"schemaVersion":3,"roles":[],"rules":[]${fields ? `,${fields}` : ""}}`
			)
		)
	);
const v3 = (fields: V3Fields) => {
	const result = decode(JSON.stringify(fields).slice(1, -1));
	if (result._tag === "Failure") throw new Error(result.failure.code);
	return result.success;
};
const v1 = (fields: V1Fields) =>
	Schema.decodeUnknownSync(GameTextRuleDocument)({ ...STARTER_GAME_TEXT_RULES, ...fields });

const harbour = "A fairly long sentence about the harbour";

describe("rule file v3", () => {
	it("decodes a file of check settings alone and validates scopes and parameters", () => {
		const document = v3({
			checks: { length_outlier: { severity: "low", params: { maximumRatio: 4 } } }
		});
		expect(document.schemaVersion).toBe(3);
		const resolved = resolveLocalizationChecks(document);
		expect(resolved.length_outlier).toEqual({
			enabled: true,
			severity: "low",
			params: { ...localizationCheckDefaults.length_outlier, maximumRatio: 4 }
		});
		expect(resolved.format_arguments.severity).toBe("normal");
		const failure = (fields: string) => {
			const result = decode(fields);
			return result._tag === "Failure" ? result.failure.code : undefined;
		};
		expect(failure(`"checks":{"length_outlier":{"scope":{"roles":["ui"]}}}`)).toBe(
			"unknown_role_id"
		);
		expect(failure(`"checks":{"length_outlier":{"params":{"minimumRatio":-1}}}`)).toBe(
			"invalid_structure"
		);
		// Version 3 rejects unknown keys: a misspelt parameter or check is not ignored.
		expect(failure(`"checks":{"length_outlier":{"params":{"ratio":2}}}`)).toBe(
			"invalid_structure"
		);
		expect(failure(`"checks":{"no_such_check":{"enabled":false}}`)).toBe("invalid_structure");
		expect(failure(`"segmentSeparator":"//"`)).toBe("invalid_structure");
		expect(failure("")).toBeUndefined();
	});

	it("applies enabled, preset, severity and parameters", () => {
		expect(kinds(line(harbour, "Hafen"))).toContain("length_outlier");
		const low = line(harbour, "Hafen", v3({ checks: { length_outlier: { severity: "low" } } }));
		expect(german(low).find((finding) => finding.kind === "length_outlier")?.severity).toBe(
			"low"
		);
		expect(
			kinds(line(harbour, "Hafen", v3({ checks: { length_outlier: { enabled: false } } })))
		).not.toContain("length_outlier");
		expect(
			kinds(
				line(
					harbour,
					"Hafen",
					v3({ checks: { length_outlier: { params: { minimumRatio: 0.1 } } } })
				)
			)
		).not.toContain("length_outlier");
		// `none` runs only what the file enables.
		const only = v3({ preset: "none", checks: { length_outlier: { enabled: true } } });
		expect(kinds(line(harbour, "Hafen  ", only))).toEqual(["length_outlier"]);
		expect(kinds(line(harbour, "Hafen  "))).toContain("whitespace");
		// The host's selection still narrows what runs.
		expect(
			kinds(line(harbour, "Hafen", undefined, { disabledChecks: ["length_outlier"] }))
		).not.toContain("length_outlier");
		// The separator check runs once it has a separator.
		const separated = "First part of it//second part of it";
		expect(kinds(line(separated, "Erster Teil zweiter Teil"))).not.toContain(
			"segment_separator"
		);
		expect(
			kinds(
				line(
					separated,
					"Erster Teil zweiter Teil",
					v3({ checks: { segment_separator: { params: { separator: "//" } } } })
				)
			)
		).toContain("segment_separator");
		expect(
			kinds(
				line(
					"Something to say about it",
					"Translation that only has TBD",
					v3({ checks: { placeholder_text: { params: { markers: [], phrases: [] } } } })
				)
			)
		).not.toContain("placeholder_text");
	});

	it("reads v1 and v2 check fields as their v3 settings and migrates them unchanged", () => {
		const legacy = v1({
			disabledLocalizationChecks: ["missing_translator_notes"],
			segmentSeparator: "//",
			optionalTags: ["italic"],
			optionalArguments: ["ParentLabel"]
		});
		const migrated = migrateGameTextRuleDocument(legacy);
		expect(migrated.schemaVersion).toBe(3);
		expect(migrated.checks?.missing_translator_notes).toEqual({ enabled: false });
		expect(migrated.checks?.segment_separator?.params).toEqual({ separator: "//" });
		expect(migrated.checks?.rich_text_tags?.params).toEqual({
			optionalTags: ["italic"],
			optionalArguments: ["ParentLabel"]
		});
		expect(Effect.runSync(decodeGameTextRuleDocumentJson(JSON.stringify(migrated)))).toEqual(
			migrated
		);
		expect(resolveLocalizationChecks(migrated)).toEqual(resolveLocalizationChecks(legacy));
		for (const [source, translation] of [
			["Cookie! Yummy nummy!", "<PlayerName>{ParentLabel}</>, cookie! Yummy nummy!"],
			["<i>Hi</> {BabyNameAuto}", "<italic>Hallo</> {BabyName1} {ParentLabel}"],
			["First part//second part", "Erster Teil zweiter Teil"],
			[harbour, "skip"]
		] as const) {
			const before = line(source, translation, legacy);
			const after = line(source, translation, migrated);
			expect(after.findings).toEqual(before.findings);
			expect(after.rules).toEqual(before.rules);
		}
	});
});
