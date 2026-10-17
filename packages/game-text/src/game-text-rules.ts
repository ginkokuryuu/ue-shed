import { Effect, Schema, Struct } from "effect";
import { CultureCode } from "@ue-shed/localization/browser";
import { BuiltInCheckId, CheckSeverity } from "./localization-check-ids.js";
import {
	localizationCheckCatalogue,
	localizationCheckDefaults,
	type LocalizationCheckCatalogue,
	type LocalizationCheckParams
} from "./localization-check-catalogue.js";
import {
	TextQualityRule,
	TextQualityRuleDocument,
	TextQualityReport,
	TextRole,
	TextRoleId,
	decodeTextQualityRuleDocument
} from "./quality-schema.js";
import type { TextCorpus } from "./schema.js";
import { evaluateTextQuality } from "./quality.js";

const [Budget, Terminology] = TextQualityRule.members;
export const LocalizationProjectRule = Schema.Union([
	Budget.mapFields(({ maximumCharacters, ...fields }) => ({
		...fields,
		kind: Schema.Literal("localization_character_budget"),
		cultures: Schema.Record(CultureCode, maximumCharacters),
		defaultMaximumCharacters: Schema.optionalKey(maximumCharacters)
	})),
	Terminology.mapFields(({ terms, ...fields }) => ({
		...fields,
		kind: Schema.Literal("localization_terminology"),
		cultures: Schema.Record(CultureCode, terms)
	}))
]);
export type LocalizationProjectRule = typeof LocalizationProjectRule.Type;

/** V1 owns source rules and role semantics; v2 adds translation policy without changing them. */
export const TextQualityRuleDocumentV2 = TextQualityRuleDocument.mapFields((fields) => ({
	...fields,
	schemaVersion: Schema.Literal(2),
	rules: Schema.Array(TextQualityRule).check(Schema.isMaxLength(512)),
	localizationRules: Schema.optionalKey(
		Schema.Array(LocalizationProjectRule).check(Schema.isMinLength(1), Schema.isMaxLength(512))
	)
}));
export type TextQualityRuleDocumentV2 = typeof TextQualityRuleDocumentV2.Type;
/**
 * Where a check applies. Each listed dimension must match: a finding's culture is one of
 * `cultures`, and one of its saved places is at a place of one of `roles` and under one of
 * `pathPrefixes` (object paths, compared as written). A finding with no saved place, such as
 * gathered-only text, matches no `roles` or `pathPrefixes` scope.
 */
export const LocalizationCheckScope = Schema.Struct({
	roles: Schema.optionalKey(
		Schema.Array(TextRoleId).check(Schema.isMinLength(1), Schema.isMaxLength(64))
	),
	cultures: Schema.optionalKey(
		Schema.Array(CultureCode).check(Schema.isMinLength(1), Schema.isMaxLength(256))
	),
	pathPrefixes: Schema.optionalKey(
		Schema.Array(Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(1024))).check(
			Schema.isMinLength(1),
			Schema.isMaxLength(64)
		)
	)
});
export type LocalizationCheckScope = typeof LocalizationCheckScope.Type;

function checkSetting<Params extends Schema.Top>(params: Params) {
	return Schema.Struct({
		/** Whether the check runs; absent, the preset decides. */
		enabled: Schema.optionalKey(Schema.Boolean),
		/** The severity of the check's findings; absent, the catalogue's. */
		severity: Schema.optionalKey(CheckSeverity),
		scope: Schema.optionalKey(LocalizationCheckScope),
		/** Parameters over the catalogue's defaults; unlisted fields keep their default. */
		params: Schema.optionalKey(params)
	});
}
type CheckSettingFields = {
	readonly [Id in BuiltInCheckId]: Schema.optionalKey<
		ReturnType<typeof checkSetting<LocalizationCheckCatalogue[Id]["params"]>>
	>;
};
// SAFETY: one optional setting per `BuiltInCheckId`, each with that check's catalogue parameters.
// Verified by: localization-check-settings.test.ts — resolves every check's own parameter schema and defaults.
const checkSettingFields = Object.fromEntries(
	BuiltInCheckId.literals.map((id) => [
		id,
		Schema.optionalKey(checkSetting(localizationCheckCatalogue[id].params))
	])
) as CheckSettingFields;

/** A version-3 rule file's settings for the built-in checks, by check ID. */
export const LocalizationCheckSettings = Schema.Struct(checkSettingFields);
export type LocalizationCheckSettings = typeof LocalizationCheckSettings.Type;

/**
 * Where checks start before the rule file's settings: `default` runs every built-in check with
 * the catalogue's severity (and `segment_separator` once it has a separator); `none` runs only the
 * checks the file enables.
 */
export const LocalizationCheckPreset = Schema.Literals(["default", "none"]);
export type LocalizationCheckPreset = typeof LocalizationCheckPreset.Type;

/**
 * V3 keeps v2's roles, source rules and localization rules and moves every built-in check's
 * policy into `checks`: whether it runs, its severity, its scope and its parameters. The v1 and
 * v2 fields `disabledLocalizationChecks`, `segmentSeparator`, `optionalTags` and
 * `optionalArguments` become check settings. A file may hold only check settings.
 */
export const TextQualityRuleDocumentV3 = TextQualityRuleDocumentV2.mapFields(
	Struct.omit([
		"disabledLocalizationChecks",
		"segmentSeparator",
		"optionalTags",
		"optionalArguments"
	])
).mapFields((fields) => ({
	...fields,
	schemaVersion: Schema.Literal(3),
	preset: Schema.optionalKey(LocalizationCheckPreset),
	roles: Schema.Array(TextRole).check(Schema.isMaxLength(256)),
	localizationRules: Schema.optionalKey(
		Schema.Array(LocalizationProjectRule).check(Schema.isMaxLength(512))
	),
	checks: Schema.optionalKey(LocalizationCheckSettings)
}));
export type TextQualityRuleDocumentV3 = typeof TextQualityRuleDocumentV3.Type;

export const GameTextRuleDocument = Schema.Union([
	TextQualityRuleDocument,
	TextQualityRuleDocumentV2,
	TextQualityRuleDocumentV3
]);
export type GameTextRuleDocument = typeof GameTextRuleDocument.Type;

export class GameTextRuleDocumentError extends Schema.TaggedError<GameTextRuleDocumentError>()(
	"GameTextRuleDocumentError",
	{
		code: Schema.Literals([
			"invalid_json",
			"invalid_structure",
			"duplicate_culture_key",
			"duplicate_role_id",
			"duplicate_rule_id",
			"unknown_role_id"
		]),
		message: Schema.String,
		recovery: Schema.String
	}
) {}

function invalid(code: GameTextRuleDocumentError["code"]): GameTextRuleDocumentError {
	if (code === "invalid_json")
		return new GameTextRuleDocumentError({
			code,
			message: "The Game Text quality rule file is not valid JSON.",
			recovery:
				"Correct the JSON syntax and retry with a version-1, version-2 or version-3 rule document."
		});
	return new GameTextRuleDocumentError({
		code,
		message: "The Game Text rule document could not be validated.",
		recovery:
			"Use version 1, 2 or 3, unique role/rule/culture keys, non-empty terms, positive budgets, valid check parameters, and declared roles (scopes included)."
	});
}

/** Called only after JSON/schema validation: inspect keys before JSON loses duplicates. */
function duplicateCultureKey(input: string): boolean {
	const stack: Array<{ keys: Set<string>; cultures: boolean }> = [];
	let pendingKey = "";
	for (let index = 0; index < input.length; index++) {
		const character = input[index];
		if (character === '"') {
			const start = index++;
			while (index < input.length) {
				if (input[index] === "\\") index += 2;
				else if (input[index] === '"') break;
				else index++;
			}
			let next = index + 1;
			while (/\s/u.test(input[next] ?? "") && next < input.length) next++;
			if (input[next] === ":") {
				pendingKey = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.String))(
					input.slice(start, index + 1)
				);
				const current = stack.at(-1);
				if (current?.cultures && current.keys.has(pendingKey)) return true;
				current?.keys.add(pendingKey);
			}
		} else if (character === "{") {
			stack.push({ keys: new Set(), cultures: pendingKey === "cultures" });
			pendingKey = "";
		} else if (character === "}") stack.pop();
	}
	return false;
}

export function decodeGameTextRuleDocumentJson(
	input: string
): Effect.Effect<GameTextRuleDocument, GameTextRuleDocumentError> {
	return Effect.gen(function* () {
		const json = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))(
			input
		).pipe(Effect.mapError(() => invalid("invalid_json")));
		const decoded = yield* Schema.decodeUnknownEffect(GameTextRuleDocument)(json).pipe(
			Effect.mapError(() => invalid("invalid_structure"))
		);
		// Version 3 rejects unknown keys, so a misspelt check or parameter is not ignored.
		const document =
			decoded.schemaVersion === 3
				? yield* Schema.decodeUnknownEffect(TextQualityRuleDocumentV3)(json, {
						onExcessProperty: "error"
					}).pipe(Effect.mapError(() => invalid("invalid_structure")))
				: decoded;
		if (document.schemaVersion === 1)
			return yield* decodeTextQualityRuleDocument(document).pipe(
				Effect.mapError((error) => invalid(error.code))
			);
		if (duplicateCultureKey(input)) return yield* Effect.fail(invalid("duplicate_culture_key"));
		const rules = [...document.rules, ...(document.localizationRules ?? [])];
		if (rules.length === 0 && document.schemaVersion === 2)
			return yield* Effect.fail(invalid("invalid_structure"));
		const roles = new Set(document.roles.map((role) => role.id));
		if (roles.size !== document.roles.length)
			return yield* Effect.fail(invalid("duplicate_role_id"));
		if (new Set(rules.map((rule) => rule.id)).size !== rules.length)
			return yield* Effect.fail(invalid("duplicate_rule_id"));
		const scopeRoles =
			document.schemaVersion === 3
				? Object.values(document.checks ?? {}).flatMap(
						(setting) => setting?.scope?.roles ?? []
					)
				: [];
		if (
			rules.some((rule) => !roles.has(rule.role)) ||
			scopeRoles.some((role) => !roles.has(role))
		)
			return yield* Effect.fail(invalid("unknown_role_id"));
		return document;
	});
}

export const GameTextSourceQualityReport = TextQualityReport.mapFields((fields) => ({
	...fields,
	ruleDocumentVersion: Schema.Literals([1, 2, 3])
}));
export type GameTextSourceQualityReport = typeof GameTextSourceQualityReport.Type;
/** Source evaluation keeps v1 behavior; translation policy requires a selected target's join. */
export function evaluateGameTextSourceQuality(
	corpus: TextCorpus,
	document: GameTextRuleDocument
): GameTextSourceQualityReport {
	if (document.schemaVersion === 1) return evaluateTextQuality(corpus, document);
	const report = evaluateTextQuality(corpus, {
		roles: document.roles,
		rules: document.rules,
		schemaVersion: 1
	});
	return { ...report, ruleDocumentVersion: document.schemaVersion };
}

/** One built-in check as a rule file resolves it. */
export interface ResolvedLocalizationCheck<Id extends BuiltInCheckId = BuiltInCheckId> {
	readonly enabled: boolean;
	readonly severity: CheckSeverity;
	readonly scope?: LocalizationCheckScope | undefined;
	readonly params: LocalizationCheckParams[Id];
}
/** Every built-in check as a rule file resolves it. */
export type ResolvedLocalizationChecks = {
	readonly [Id in BuiltInCheckId]: ResolvedLocalizationCheck<Id>;
};

const resolvedCache = new WeakMap<GameTextRuleDocument, ResolvedLocalizationChecks>();

/**
 * Each built-in check's settings under a rule file: v3 `checks` over its preset, or the v1 and v2
 * fields as their v3 equivalents. Without a file, every check runs with the catalogue's severity
 * and defaults. `segment_separator` runs only once it has a separator. Resolved once per document.
 */
export function resolveLocalizationChecks(
	document: GameTextRuleDocument | undefined
): ResolvedLocalizationChecks {
	const cached = document && resolvedCache.get(document);
	if (cached) return cached;
	const settings: LocalizationCheckSettings =
		document === undefined
			? {}
			: document.schemaVersion === 3
				? (document.checks ?? {})
				: legacyCheckSettings(document);
	const presetEnabled = document?.schemaVersion !== 3 || document.preset !== "none";
	const separated = settings.segment_separator?.params?.separator !== undefined;
	// SAFETY: one entry per `BuiltInCheckId`, each with that check's catalogue parameters.
	// Verified by: localization-check-settings.test.ts — resolves every check's own parameter schema and defaults.
	const resolved = Object.fromEntries(
		BuiltInCheckId.literals.map((id) => {
			const setting = settings[id];
			const params = setting?.params ?? localizationCheckDefaults[id];
			const enabled =
				(setting?.enabled ?? presetEnabled) && (id !== "segment_separator" || separated);
			return [
				id,
				{
					enabled,
					severity: setting?.severity ?? localizationCheckCatalogue[id].severity,
					...(setting?.scope ? { scope: setting.scope } : undefined),
					params
				}
			];
		})
	) as ResolvedLocalizationChecks;
	if (document) resolvedCache.set(document, resolved);
	return resolved;
}

/** The v1 and v2 check fields as v3 check settings, as `migrateGameTextRuleDocument` writes them. */
function legacyCheckSettings(document: TextQualityRuleDocument | TextQualityRuleDocumentV2) {
	const settings: { -readonly [Id in BuiltInCheckId]?: LocalizationCheckSettings[Id] } = {};
	for (const id of document.disabledLocalizationChecks ?? []) settings[id] = { enabled: false };
	const optionalArguments = document.optionalArguments ?? [];
	const optionalTags = document.optionalTags ?? [];
	const withParams = <Id extends BuiltInCheckId>(id: Id, params: LocalizationCheckParams[Id]) => {
		// SAFETY: `params` are check `Id`'s, so the setting is that check's setting.
		// Verified by: localization-check-settings.test.ts — reads v1 and v2 check fields as their v3 settings and migrates them unchanged.
		settings[id] = { ...settings[id], params } as LocalizationCheckSettings[Id];
	};
	if (document.segmentSeparator !== undefined)
		withParams("segment_separator", { separator: document.segmentSeparator });
	if (optionalArguments.length) {
		withParams("format_arguments", { optionalArguments });
		withParams("format_argument_renamed", { optionalArguments });
		withParams("rich_text_tag_case", { optionalArguments });
	}
	if (optionalArguments.length || optionalTags.length) {
		withParams("rich_text_tags", { optionalTags, optionalArguments });
		withParams("rich_text_tags_added", { optionalTags, optionalArguments });
	}
	return settings;
}

/**
 * A v1 or v2 rule file as version 3, with the same roles, rules and check behaviour; a v3 file
 * is returned as it is. Hosts that edit rule files can offer it as an upgrade.
 */
export function migrateGameTextRuleDocument(
	document: GameTextRuleDocument
): TextQualityRuleDocumentV3 {
	if (document.schemaVersion === 3) return document;
	const checks = legacyCheckSettings(document);
	return {
		schemaVersion: 3,
		roles: document.roles,
		rules: document.rules,
		...(document.schemaVersion === 2 && document.localizationRules
			? { localizationRules: document.localizationRules }
			: undefined),
		...(Object.keys(checks).length ? { checks } : undefined)
	};
}
