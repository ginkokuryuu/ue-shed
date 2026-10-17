import type { CultureCode } from "@ue-shed/localization/browser";
import type { CustomLocalizationCheck, GameTextRuleDocument } from "./game-text-rules.js";
import { localizationCheckInScope } from "./localization-check-scope.js";
import type {
	LocalizationCheckOptions,
	LocalizationCustomFinding
} from "./localization-quality-schema.js";
import type { LocalizationJoin, LocalizationLine } from "./localization-schema.js";
import { localizationShippedTranslation } from "./localization-shipped-translation.js";
import { visibleTextLength } from "./localization-text-shape.js";
import type { TextRole } from "./quality-schema.js";
import { termMatches } from "./quality.js";
import type { TextUnit } from "./schema.js";

/** The custom checks of a rule file, in the file's order; none before version 3. */
export function customLocalizationChecks(
	document: GameTextRuleDocument | undefined
): readonly CustomLocalizationCheck[] {
	return document?.schemaVersion === 3 ? (document.customChecks ?? []) : [];
}

/** What a line's custom checks share: the target, the selection and the file's roles. */
export interface CustomCheckContext {
	readonly target: LocalizationJoin["target"];
	readonly nativeCulture: LocalizationJoin["nativeCulture"];
	readonly options: LocalizationCheckOptions;
	readonly roles: ReadonlyMap<string, TextRole>;
}

const MAX_MATCHES = 16;
const patterns = new WeakMap<CustomLocalizationCheck, RegExp>();
function patternOf(check: Extract<CustomLocalizationCheck, { kind: "pattern" }>): RegExp {
	let pattern = patterns.get(check);
	if (!pattern) {
		pattern = new RegExp(check.pattern, check.caseSensitive === false ? "giu" : "gu");
		patterns.set(check, pattern);
	}
	return pattern;
}

type Detected = Pick<LocalizationCustomFinding, "actual" | "expectation">;

/** What a custom check finds in one text, or undefined when the text passes. */
export function detectCustomCheck(
	check: CustomLocalizationCheck,
	text: string
): Detected | undefined {
	switch (check.kind) {
		case "pattern": {
			const report = check.report ?? "match";
			const matches: { match: string; start: number; end: number }[] = [];
			let matched = false;
			let examined = 0;
			for (const match of text.matchAll(patternOf(check))) {
				matched = true;
				if (report === "no_match") return undefined;
				// Empty matches establish regex truth but have no highlightable span. Count them
				// toward the evidence budget too, so anchor/lookahead checks stop at the limit.
				if (match[0].length > 0)
					matches.push({
						match: match[0],
						start: match.index,
						end: match.index + match[0].length
					});
				if (++examined === MAX_MATCHES) break;
			}
			if (report === "match" && !matched) return undefined;
			return {
				actual: { text, ...(report === "match" ? { matches } : undefined) },
				expectation: { pattern: check.pattern, report }
			};
		}
		case "length": {
			const length = check.measure === "visible" ? visibleTextLength(text) : [...text].length;
			if (
				(check.minimum === undefined || length >= check.minimum) &&
				(check.maximum === undefined || length <= check.maximum)
			)
				return undefined;
			return {
				actual: { text, length },
				expectation: {
					measure: check.measure,
					...(check.minimum !== undefined ? { minimum: check.minimum } : undefined),
					...(check.maximum !== undefined ? { maximum: check.maximum } : undefined)
				}
			};
		}
		case "forbidden_term": {
			const matches = check.terms
				.flatMap((term) => termMatches(text, term, check.caseSensitive))
				.sort((a, b) => a.start - b.start)
				.slice(0, MAX_MATCHES)
				.map(({ matched, start, end }) => ({ match: matched, start, end }));
			if (matches.length === 0) return undefined;
			return { actual: { text, matches }, expectation: { terms: check.terms } };
		}
	}
}

/**
 * One custom check against one keyed line. A `source` check reads the manifest source (or the
 * saved one) once, under `sourceCulture`; a `translation` check reads each culture's shipped
 * translation, the native culture aside. A finding is kept when the check's scope holds; units
 * are built only for a finding whose scope names roles or paths, or that is kept.
 */
export function localizationLineCustomFindings(
	line: LocalizationLine,
	units: () => readonly TextUnit[],
	check: CustomLocalizationCheck,
	sourceCulture: CultureCode | undefined,
	context: CustomCheckContext,
	findings: LocalizationCustomFinding[]
): void {
	if (!line.identity) return;
	const identity = line.identity;
	let affected: LocalizationCustomFinding["affectedOccurrences"] | undefined;
	const places = () => units().flatMap((unit) => unit.occurrences);
	const manifestLocations = [...new Set(line.manifest.map((entry) => entry.path))].sort();
	const add = (
		culture: CultureCode,
		text: string,
		translationOrigin: LocalizationCustomFinding["translationOrigin"]
	) => {
		const detected = detectCustomCheck(check, text);
		if (!detected) return;
		if (!localizationCheckInScope(check.scope, culture, places, context.roles)) return;
		findings.push({
			lineId: line.id,
			target: context.target,
			culture,
			identity,
			ruleId: check.id,
			recovery: check.recovery,
			affectedOccurrences: (affected ??= places()
				.map(({ id, location, packageFile }) => ({ id, location, packageFile }))
				.sort((a, b) => a.id.localeCompare(b.id))),
			manifestLocations,
			translationOrigin,
			severity: check.severity ?? "normal",
			kind: "custom",
			check: check.kind,
			label: check.label,
			subject: check.subject,
			...detected
		});
	};
	if (check.subject === "source") {
		if (
			sourceCulture === undefined ||
			(context.options.culture && context.options.culture !== sourceCulture)
		)
			return;
		const source = line.manifest[0]?.source.Text ?? line.source;
		add(sourceCulture, source, "absent");
		return;
	}
	for (const culture of [...line.cultures].sort((a, b) => a.culture.localeCompare(b.culture))) {
		if (
			culture.state === "outside_target" ||
			culture.culture === context.nativeCulture ||
			(context.options.culture && context.options.culture !== culture.culture)
		)
			continue;
		const shipped = localizationShippedTranslation(culture);
		if (shipped.value === null) continue;
		add(culture.culture, shipped.value, shipped.origin);
	}
}
