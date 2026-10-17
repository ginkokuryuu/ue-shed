import { Schema } from "effect";
import { CultureCode } from "@ue-shed/localization/browser";
import type { TextCorpus, TextUnit } from "./schema.js";
import type { LocalizationJoin, LocalizationLine } from "./localization-schema.js";
import type { TextQualityRuleDocumentV2, TextQualityRuleDocumentV3 } from "./game-text-rules.js";

/** A rule file with localization rules: version 2 or later. */
type PolicyDocument = TextQualityRuleDocumentV2 | TextQualityRuleDocumentV3;
import type {
	LocalizationCheckOptions,
	LocalizationPolicyFinding,
	LocalizationRuleDiagnostic
} from "./localization-quality-schema.js";
import { localizationShippedTranslation } from "./localization-shipped-translation.js";
import { matchesTextRole, termMatches } from "./quality.js";
import { localizationLineUnits } from "./gathered-text.js";

type LocalizationRule = NonNullable<PolicyDocument["localizationRules"]>[number];
type TextRole = PolicyDocument["roles"][number];
export type LocalizationPolicyRule = { readonly rule: LocalizationRule; readonly role: TextRole };

/** Rules in evaluation order with their roles, and the diagnostics that need no lines. */
export function localizationPolicyRules(
	cultures: LocalizationJoin["cultures"],
	document: PolicyDocument
) {
	const diagnostics: LocalizationRuleDiagnostic[] = [];
	const rules: LocalizationPolicyRule[] = [];
	const roles = new Map(document.roles.map((role) => [role.id, role]));
	for (const rule of [...(document.localizationRules ?? [])].sort((a, b) =>
		a.id.localeCompare(b.id)
	)) {
		for (const key of Object.keys(rule.cultures).sort()) {
			const culture = Schema.decodeUnknownSync(CultureCode)(key);
			if (!cultures.includes(culture))
				diagnostics.push({
					code: "rule_culture_not_in_target",
					severity: "warning",
					culture,
					ruleId: rule.id,
					recovery:
						"Keep project-wide cultures when intentional, or correct the culture in this rule."
				});
		}
		const role = roles.get(rule.role);
		if (role) rules.push({ rule, role });
	}
	return { rules, diagnostics };
}

/** One rule against one line. `units` returns the line's gathered units. */
export function localizationLinePolicyFindings(
	line: LocalizationLine,
	units: () => readonly TextUnit[],
	{ rule, role }: LocalizationPolicyRule,
	target: LocalizationJoin["target"],
	options: LocalizationCheckOptions,
	findings: LocalizationPolicyFinding[]
) {
	if (!line.identity || !line.source.trim() || line.origin.kind !== "corpus") return;
	const checked = (culture: LocalizationLine["cultures"][number]) =>
		culture.state !== "outside_target" &&
		(!options.culture || options.culture === culture.culture) &&
		localizationShippedTranslation(culture).value !== null;
	// Units are built only for a line with a translation to check: a key saved in thousands of
	// places, such as an untranslated editor label, takes seconds to build.
	if (!line.cultures.some(checked)) return;
	const occurrences = units()
		.flatMap((unit) => unit.occurrences)
		.filter((occurrence) => matchesTextRole(occurrence, role))
		.sort((a, b) => a.id.localeCompare(b.id));
	if (!occurrences.length) return;
	for (const culture of [...line.cultures].sort((a, b) => a.culture.localeCompare(b.culture))) {
		if (
			culture.state === "outside_target" ||
			(options.culture && options.culture !== culture.culture)
		)
			continue;
		const shipped = localizationShippedTranslation(culture);
		if (shipped.value === null) continue;
		const translation = shipped.value;
		const base = {
			lineId: line.id,
			target,
			culture: culture.culture,
			identity: line.identity,
			role: role.id,
			ruleId: rule.id,
			recovery: rule.recovery,
			translationOrigin: shipped.origin,
			severity: "normal" as const,
			affectedOccurrences: occurrences.map(({ id, location, packageFile }) => ({
				id,
				location,
				packageFile
			})),
			manifestLocations: [...new Set(line.manifest.map((entry) => entry.path))].sort()
		};
		if (rule.kind === "localization_character_budget") {
			const maximum = rule.cultures[culture.culture] ?? rule.defaultMaximumCharacters;
			if (maximum !== undefined && translation.length > maximum)
				findings.push({
					...base,
					kind: rule.kind,
					actual: {
						kind: "character_count",
						characterCount: translation.length,
						translation
					},
					expectation: { kind: "maximum_characters", maximumCharacters: maximum }
				});
		} else {
			for (const term of rule.cultures[culture.culture] ?? []) {
				const alternatives =
					term.kind === "forbidden" ? [term.term] : [...term.alternatives].sort();
				for (const alternative of alternatives)
					for (const match of termMatches(translation, alternative, rule.caseSensitive))
						findings.push({
							...base,
							kind: rule.kind,
							actual: {
								kind: "terminology_match",
								translation,
								start: match.start,
								end: match.end,
								term: match.matched
							},
							expectation:
								term.kind === "forbidden"
									? { kind: "forbidden_term", term: term.term }
									: {
											kind: "preferred_term",
											discouragedTerm: alternative,
											preferredTerm: term.term
										}
						});
			}
		}
	}
}

export function evaluateLocalizationPolicy(
	corpus: TextCorpus,
	join: LocalizationJoin,
	document: PolicyDocument,
	options: LocalizationCheckOptions
) {
	const findings: LocalizationPolicyFinding[] = [];
	const { rules, diagnostics } = localizationPolicyRules(join.cultures, document);
	const units = new Map(corpus.units.map((unit) => [unit.id, unit]));
	const lines = [...join.lines].sort((a, b) => a.id.localeCompare(b.id));
	for (const rule of rules)
		for (const line of lines)
			localizationLinePolicyFindings(
				line,
				() => localizationLineUnits(line, units),
				rule,
				join.target,
				options,
				findings
			);
	return { findings, diagnostics };
}
