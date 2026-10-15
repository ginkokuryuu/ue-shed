import { textCorpusDiagnosticSummary } from "./corpus-summary.js";
import type {
	CultureCode,
	LocalizationChangeSet,
	LocalizationIdentity,
	LocalizationTargetEvidence
} from "@ue-shed/localization/browser";
import { BuiltInCheckId, checkSeverity } from "./localization-check-ids.js";
import { localizationManifestNotes } from "./localization.js";
import { localizationLineUnits } from "./gathered-text.js";
import {
	GameTextLocalizationError,
	type LocalizationJoin,
	type LocalizationLine,
	type LocalizationCultureState
} from "./localization-schema.js";
import {
	LocalizationQualityReport,
	type LocalizationQualityFinding,
	type LocalizationPolicyFinding,
	type LocalizationCheckOptions,
	type LocalizationCheckDiagnostic
} from "./localization-quality-schema.js";
import { localizationEvidenceFileStatuses } from "./localization-status.js";
import { TextQualityRuleId, type TextQualityAffectedOccurrence } from "./quality-schema.js";
import type { GameTextRuleDocument } from "./quality-rules-v2.js";
import { evaluateLocalizationPolicy } from "./localization-policy.js";
import { localizationShippedTranslation } from "./localization-shipped-translation.js";
import { withoutAcceptedFindings } from "./localization-review.js";
export {
	localizationShippedTranslation,
	LocalizationShippedTranslation
} from "./localization-shipped-translation.js";
import type { TextCorpus, TextUnit } from "./schema.js";
import {
	LENGTH_OUTLIER,
	compareRichTextTags,
	consistentTranslationCandidate,
	countOccurrences,
	formatBraceBalance,
	lengthOutlier,
	numberOnlyText,
	placeholderMatches,
	richTextTagBalance,
	sharedSourceCandidate,
	sourceWhitespace,
	visibleTextLength
} from "./localization-text-shape.js";
import {
	parseUnrealFormatPattern,
	unrealRichTextCounts,
	unrealRichTextValid,
	unrealWhitespace,
	unrealUnsafeWhitespace,
	type UnrealFormatPattern,
	type UnrealModifierIdentity
} from "./unreal-text-syntax.js";

interface FindingBase {
	readonly lineId: LocalizationQualityFinding["lineId"];
	readonly target: LocalizationQualityFinding["target"];
	readonly culture: LocalizationQualityFinding["culture"];
	readonly identity: LocalizationIdentity;
	readonly affectedOccurrences: LocalizationQualityFinding["affectedOccurrences"];
	readonly manifestLocations: LocalizationQualityFinding["manifestLocations"];
	readonly translationOrigin: LocalizationQualityFinding["translationOrigin"];
	readonly sourceVariants?: readonly string[];
}
/** A finding before `add` sets its check's severity. */
type Unrated<F> = F extends unknown ? Omit<F, "severity"> : never;
type UnratedFinding = Unrated<LocalizationQualityFinding>;
type LocalizationChange = LocalizationChangeSet["changes"][number];
type DuplicateSourceActual = Extract<
	LocalizationQualityFinding,
	{ kind: "duplicate_source" }
>["actual"];

function argumentNames(pattern: UnrealFormatPattern): readonly string[] {
	return [...new Set(pattern.arguments.map((argument) => argument.name))].sort();
}

function modifiers(pattern: UnrealFormatPattern): readonly UnrealModifierIdentity[] {
	return pattern.modifiers
		.map((modifier) => ({ argument: modifier.argument, name: modifier.name }))
		.sort(
			(a, b) =>
				(a.argument ?? "").localeCompare(b.argument ?? "") || a.name.localeCompare(b.name)
		);
}

function renameArgument(
	text: string,
	from: string,
	to: string,
	culture: LocalizationCultureState["culture"]
): string | undefined {
	const parsed = parseUnrealFormatPattern(text, culture);
	if (parsed.compiled !== true) return undefined;
	const replacements = parsed.arguments
		.filter((argument) => argument.name === from && argument.start >= 0)
		.map((argument) => ({
			start: argument.start,
			end: argument.end,
			value: `{${to}}`
		}));
	for (const modifier of parsed.modifiers.filter(
		(item) => item.depth === 0 && item.name !== "hpp"
	)) {
		const forms = modifier.forms.map((form) => ({
			...form,
			renamed: renameArgument(form.value, from, to, culture)
		}));
		if (forms.some((form) => form.renamed === undefined)) return undefined;
		if (!forms.some((form) => form.renamed !== form.value)) continue;
		const values = forms.map(
			(form) =>
				`${modifier.name === "plural" || modifier.name === "ordinal" ? `${form.name}=` : ""}${JSON.stringify(form.renamed)}`
		);
		replacements.push({
			start: modifier.start,
			end: modifier.end,
			value: `|${modifier.name}(${values.join(",")})`
		});
	}
	let value = text;
	for (const replacement of [...replacements].sort((a, b) => b.start - a.start))
		value =
			value.slice(0, replacement.start) + replacement.value + value.slice(replacement.end);
	return value;
}

/** Built-in checks shared by every line of a target; prepared once per target. */
export interface LocalizationLineCheckContext {
	readonly target: LocalizationJoin["target"];
	/** Source-level findings belong to this culture when the line has it in the target. */
	readonly nativeCulture: LocalizationJoin["nativeCulture"];
	readonly options: LocalizationCheckOptions;
	readonly enabled: readonly BuiltInCheckId[];
	/** Shared sources by text; only sources with more than one identity are needed. */
	readonly duplicates: ReadonlyMap<string, DuplicateSourceActual>;
	/** Shipped translations of shared sources by source and culture; only those that differ. */
	readonly translations: ReadonlyMap<
		string,
		ReadonlyMap<CultureCode, LocalizationTranslationVariants>
	>;
	/** The rule file's `segmentSeparator`, when it has one. */
	readonly segmentSeparator?: string | undefined;
}

export interface LocalizationLineCheckOutput {
	readonly findings: LocalizationQualityFinding[];
	readonly checkDiagnostics: LocalizationCheckDiagnostic[];
	readonly changes: LocalizationChange[];
}

/**
 * The culture a line's source-level findings (`missing_translator_notes`, `duplicate_source` and
 * the source checks) are reported under, once per line: the target's native culture when the line
 * has it in the target, otherwise the first of its cultures in the target by code.
 */
export function localizationSourceCulture(
	line: Pick<LocalizationLine, "cultures">,
	nativeCulture: LocalizationJoin["nativeCulture"]
): LocalizationCultureState["culture"] | undefined {
	let first: LocalizationCultureState["culture"] | undefined;
	for (const culture of line.cultures) {
		if (culture.state === "outside_target") continue;
		if (culture.culture === nativeCulture) return culture.culture;
		if (first === undefined || culture.culture.localeCompare(first) < 0)
			first = culture.culture;
	}
	return first;
}

/** Rejects a selection outside the target and lists the built-in checks that run. */
export function enabledLocalizationChecks(
	join: Pick<LocalizationJoin, "target" | "cultures">,
	evidence: LocalizationTargetEvidence,
	options: LocalizationCheckOptions = {},
	ruleDocument?: GameTextRuleDocument
): readonly BuiltInCheckId[] {
	if (
		join.target !== evidence.target.name ||
		(options.culture !== undefined && !join.cultures.includes(options.culture))
	)
		throw new GameTextLocalizationError({
			code: "invalid_selection",
			message: "The localization check selection is invalid.",
			recovery: "Choose a loaded target and one of its listed cultures."
		});
	const disabled = new Set([
		...(options.disabledChecks ?? []),
		...(ruleDocument?.disabledLocalizationChecks ?? [])
	]);
	// The separator check has nothing to compare until the rule file names a separator.
	if (ruleDocument?.segmentSeparator === undefined) disabled.add("segment_separator");
	return BuiltInCheckId.literals.filter(
		(id) => !disabled.has(id) && (!options.checks || options.checks.includes(id))
	);
}

/** One key with several saved texts; the join's line source joins them for search. */
export function localizationConflictingSource(line: Pick<LocalizationLine, "cultures">): boolean {
	return line.cultures.some((culture) => culture.unknownReasons.includes("conflicting_source"));
}

/**
 * Lines with an identity, one source with letters and at least one culture in the target can
 * share a source. Number-only text and keys with conflicting sources are left out.
 */
export function localizationDuplicateCandidate(line: LocalizationLine): boolean {
	return (
		line.identity !== null &&
		line.source.trim().length > 0 &&
		sharedSourceCandidate(line.source) &&
		!line.cultures.every((culture) => culture.state === "outside_target") &&
		!localizationConflictingSource(line)
	);
}

/**
 * Groups candidate lines by source. Identities are sorted; the first five are kept, and the first
 * line carries the group's one finding. Identities that compare equal keep their lines' join order:
 * the order they are added in, unless the caller adds them in another order and passes each line's
 * position in the join. `rows` are the callers' row numbers of every line in a shared group, in
 * ascending order with each row's source in `rowSources`, for a second pass over just those lines.
 */
export function localizationDuplicateSources() {
	// Identity, join position and row, in turn; no object per line.
	const groups = new Map<string, Array<LocalizationIdentity | number>>();
	let added = 0;
	return {
		add(source: string, identity: LocalizationIdentity, joinPosition = added, row = -1) {
			added++;
			const group = groups.get(source);
			if (group) group.push(identity, joinPosition, row);
			else groups.set(source, [identity, joinPosition, row]);
		},
		finish() {
			const shared = new Map<string, DuplicateSourceActual>();
			const rows: Array<{ row: number; source: string }> = [];
			for (const [source, group] of groups) {
				if (group.length < 6) continue;
				// SAFETY: `add` is the only writer and pushes an identity, its position and row.
				const identities = Array.from({ length: group.length / 3 }, (_, index) => ({
					identity: group[index * 3] as LocalizationIdentity,
					position: group[index * 3 + 1] as number,
					row: group[index * 3 + 2] as number
				})).sort(
					(a, b) =>
						a.identity.namespace.localeCompare(b.identity.namespace) ||
						a.identity.key.localeCompare(b.identity.key) ||
						a.position - b.position
				);
				shared.set(source, {
					source,
					identityCount: identities.length,
					identities: identities.slice(0, 5).map(({ identity }) => identity)
				});
				for (const { row } of identities) if (row >= 0) rows.push({ row, source });
			}
			groups.clear();
			rows.sort((a, b) => a.row - b.row);
			return {
				shared,
				rows: rows.map(({ row }) => row),
				rowSources: rows.map(({ source }) => source)
			};
		}
	};
}

/** One shared source's shipped translations in one culture. */
export interface LocalizationTranslationVariants {
	/** Distinct translations and how many lines ship each: most used first, then by text. */
	readonly variants: ReadonlyArray<{ readonly translation: string; readonly lines: number }>;
	/** The one most used translation; undefined when several tie for it. */
	readonly majority: string | undefined;
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Counts each shared source's shipped translations per culture, for `inconsistent_translation`.
 * Only lines in `shared` groups with a source worth comparing are counted, so memory follows the
 * distinct translations of shared lines, not the target. Counts do not depend on the order lines
 * are added in. `finish` keeps the cultures with more than one translation.
 */
export function localizationTranslationVariants(
	shared: ReadonlyMap<string, DuplicateSourceActual>
) {
	const groups = new Map<string, Map<CultureCode, Map<string, number>>>();
	/** One culture's non-empty shipped translation of a candidate line. */
	const count = (source: string, culture: CultureCode, translation: string) => {
		let cultures = groups.get(source);
		if (!cultures) groups.set(source, (cultures = new Map()));
		let counts = cultures.get(culture);
		if (!counts) cultures.set(culture, (counts = new Map()));
		counts.set(translation, (counts.get(translation) ?? 0) + 1);
	};
	return {
		/** A hydrated line: counted when it is a candidate, for each culture in the target. */
		add(line: LocalizationLine) {
			if (!localizationTranslationCandidate(line, shared)) return;
			for (const culture of line.cultures) {
				if (culture.state === "outside_target") continue;
				const translation = localizationShippedTranslation(culture).value;
				if (translation) count(line.source, culture.culture, translation);
			}
		},
		/**
		 * One culture of a line the caller read from columns: a line of a shared group whose source
		 * passes `consistentTranslationCandidate`, in a culture inside the target.
		 */
		addTranslation(source: string, culture: CultureCode, translation: string) {
			if (translation) count(source, culture, translation);
		},
		finish(): ReadonlyMap<string, ReadonlyMap<CultureCode, LocalizationTranslationVariants>> {
			const result = new Map<string, Map<CultureCode, LocalizationTranslationVariants>>();
			for (const [source, cultures] of groups) {
				for (const [culture, counts] of cultures) {
					if (counts.size < 2) continue;
					const variants = Array.from(counts, ([translation, lines]) => ({
						translation,
						lines
					})).sort(
						(a, b) => b.lines - a.lines || byCodeUnit(a.translation, b.translation)
					);
					let byCulture = result.get(source);
					if (!byCulture) result.set(source, (byCulture = new Map()));
					byCulture.set(culture, {
						variants,
						majority:
							variants[0]!.lines > variants[1]!.lines
								? variants[0]!.translation
								: undefined
					});
				}
			}
			groups.clear();
			return result;
		}
	};
}

/** A line whose translations `inconsistent_translation` compares with its shared source's. */
function localizationTranslationCandidate(
	line: LocalizationLine,
	shared: ReadonlyMap<string, DuplicateSourceActual>
): boolean {
	return (
		(shared.get(line.source)?.identityCount ?? 0) > 1 &&
		localizationDuplicateCandidate(line) &&
		consistentTranslationCandidate(line.source)
	);
}

/** Built-in finding order: line, culture, check, then the observed value. */
export function compareLocalizationFindings(
	a: LocalizationQualityFinding,
	b: LocalizationQualityFinding
) {
	return (
		a.lineId.localeCompare(b.lineId) ||
		a.culture.localeCompare(b.culture) ||
		a.kind.localeCompare(b.kind) ||
		JSON.stringify(a.actual).localeCompare(JSON.stringify(b.actual))
	);
}

/** Report order once policy findings join the built-ins. */
export function compareReportedLocalizationFindings(
	a: LocalizationQualityFinding | LocalizationPolicyFinding,
	b: LocalizationQualityFinding | LocalizationPolicyFinding
) {
	return (
		a.lineId.localeCompare(b.lineId) ||
		a.culture.localeCompare(b.culture) ||
		a.kind.localeCompare(b.kind) ||
		a.ruleId.localeCompare(b.ruleId) ||
		JSON.stringify(a.actual).localeCompare(JSON.stringify(b.actual))
	);
}

/** Argument names in order of first appearance. */
function argumentOrder(pattern: UnrealFormatPattern): readonly string[] {
	return [...new Set(pattern.arguments.map((argument) => argument.name))];
}

/**
 * A line's distinct saved sources when they conflict, sorted: the texts its authored occurrences
 * (String Table references aside, as in the join) carry. Undefined unless there are several.
 */
function conflictingSourceVariants(
	line: LocalizationLine,
	lineUnits: readonly TextUnit[]
): readonly string[] | undefined {
	if (!localizationConflictingSource(line)) return undefined;
	const authored = lineUnits.filter((unit) => unit.identity.status !== "string_table");
	const sources = new Set<string>();
	for (const unit of authored.length ? authored : lineUnits)
		for (const occurrence of unit.occurrences) sources.add(occurrence.source);
	return sources.size > 1 ? [...sources].sort(byCodeUnit) : undefined;
}

const ruleIdOf = (id: BuiltInCheckId) => TextQualityRuleId.make(`localization.${id}`);
const sameIdentity = (a: LocalizationIdentity | undefined, b: LocalizationIdentity) =>
	a !== undefined && a.namespace === b.namespace && a.key === b.key;
const affectedOf = (lineUnits: readonly TextUnit[]): TextQualityAffectedOccurrence[] =>
	lineUnits
		.flatMap((unit) =>
			unit.occurrences.map((occurrence) => ({
				id: occurrence.id,
				packageFile: occurrence.packageFile,
				location: occurrence.location
			}))
		)
		.sort((a, b) => a.id.localeCompare(b.id));

/** Source checks of one text: the line's source, or each of its conflicting sources. */
function sourceTextFindings(
	text: string,
	base: FindingBase,
	add: (finding: UnratedFinding) => void
) {
	const matches = placeholderMatches(text);
	if (matches.length)
		add({
			...base,
			ruleId: ruleIdOf("placeholder_text"),
			kind: "placeholder_text",
			actual: { source: text, matches },
			expectation: { finalText: true },
			recovery:
				"Replace the placeholder with final text, or keep the line out of the build until it has some."
		});
	const space = sourceWhitespace(text);
	if (space.leading || space.trailing || space.repeatedSpaces)
		add({
			...base,
			ruleId: ruleIdOf("source_whitespace"),
			kind: "source_whitespace",
			actual: { source: text, ...space },
			expectation: { trimmed: true },
			recovery:
				"Remove spaces and line breaks at the ends and doubled spaces; build spacing into the format pattern instead of joining text."
		});
	const richText = richTextTagBalance(text),
		braces = formatBraceBalance(text);
	if (richText.opening !== richText.closing || braces.opening !== braces.closing)
		add({
			...base,
			ruleId: ruleIdOf("source_markup"),
			kind: "source_markup",
			actual: { source: text, richText, braces },
			expectation: { balanced: true },
			recovery:
				"Close each rich-text tag with </> and pair each { with }; escape a literal brace with a backtick."
		});
	if (numberOnlyText(text))
		add({
			...base,
			ruleId: ruleIdOf("number_only_text"),
			kind: "number_only_text",
			actual: { source: text },
			expectation: { cultureInvariant: true },
			recovery:
				"Make number-only text culture invariant, or format the number with FText::AsNumber, so translators are not sent it."
		});
}

/** One line's built-in findings, check diagnostics and suggested changes, in check order. */
export function checkLocalizationLine(
	line: LocalizationLine,
	units: () => readonly TextUnit[],
	context: LocalizationLineCheckContext,
	{ findings, checkDiagnostics, changes }: LocalizationLineCheckOutput
): void {
	const { target, options, enabled } = context;
	const cultures = [...line.cultures].sort((a, b) => a.culture.localeCompare(b.culture));
	for (const culture of cultures) {
		if (
			(options.culture && culture.culture !== options.culture) ||
			culture.state === "outside_target"
		)
			continue;
		for (const code of culture.unknownReasons)
			checkDiagnostics.push({ lineId: line.id, culture: culture.culture, code });
		if (culture.reducedSourceChecking)
			checkDiagnostics.push({
				lineId: line.id,
				culture: culture.culture,
				code: "reduced_source_checking"
			});
	}
	const add = (finding: UnratedFinding) => {
		if (enabled.includes(finding.kind))
			// SAFETY: `finding` is one member of the union without its severity, and the severity
			// added is the one `checkSeverity` gives that member's kind.
			findings.push({
				...finding,
				severity: checkSeverity[finding.kind]
			} as LocalizationQualityFinding);
	};
	const sourceCulture = localizationSourceCulture(line, context.nativeCulture);
	if (!line.identity) {
		if (
			sourceCulture === undefined ||
			(options.culture && options.culture !== sourceCulture) ||
			!enabled.includes("culture_invariant_text") ||
			!sharedSourceCandidate(line.source)
		)
			return;
		const lineUnits = units();
		const occurrences = lineUnits.flatMap((unit) => unit.occurrences);
		if (
			occurrences.length > 0 &&
			occurrences.every(
				(occurrence) =>
					occurrence.identity.status === "unresolved" &&
					occurrence.identity.reason === "culture_invariant"
			)
		)
			add({
				lineId: line.id,
				target,
				culture: sourceCulture,
				identity: null,
				affectedOccurrences: affectedOf(lineUnits),
				manifestLocations: [],
				translationOrigin: "absent",
				ruleId: ruleIdOf("culture_invariant_text"),
				kind: "culture_invariant_text",
				actual: { source: line.source },
				expectation: { localizable: true },
				recovery:
					"Make the text localizable (clear Culture Invariant, or use NSLOCTEXT/LOCTEXT or a String Table) so the gather collects it; keep it invariant only if players never see it."
			});
		return;
	}
	const manifestSource = line.manifest[0]?.source.Text;
	const source = manifestSource ?? line.source;
	// A partly read package can leave the saved text blank; the manifest's source still counts.
	if (source.trim().length === 0 && line.source.trim().length === 0) return;
	const lineUnits = units();
	const affectedOccurrences = affectedOf(lineUnits);
	const notes = lineUnits
		.flatMap((unit) => unit.occurrences.map((occurrence) => occurrence.devNotes))
		.filter((note) => note.trim().length > 0);
	const sourceVariants = conflictingSourceVariants(line, lineUnits);
	// Conflicting texts without a manifest leave no one source to compare a translation with.
	const comparable = sourceVariants === undefined || manifestSource !== undefined;
	const manifestLocations = [...new Set(line.manifest.map((entry) => entry.path))].sort();
	const candidate = localizationDuplicateCandidate(line);
	/** The source's visible length, measured once for every culture. */
	let sourceLength: number | undefined;
	for (const culture of cultures) {
		if (
			(options.culture && culture.culture !== options.culture) ||
			culture.state === "outside_target"
		)
			continue;
		const shipped = localizationShippedTranslation(culture);
		const base: FindingBase = {
			lineId: line.id,
			target,
			culture: culture.culture,
			identity: line.identity,
			affectedOccurrences,
			manifestLocations,
			translationOrigin: shipped.origin,
			...(sourceVariants ? { sourceVariants } : undefined)
		};
		const emptyPO = culture.po?.msgstr["0"] === "";
		const emptyArchive = culture.archive?.translation.Text === "";
		if (emptyPO || emptyArchive)
			add({
				...base,
				translationOrigin: emptyPO ? "po" : "archive",
				ruleId: ruleIdOf("empty_translation"),
				kind: "empty_translation",
				actual: { entryExists: true, translation: "" },
				expectation: { nonEmptyTranslation: true },
				recovery:
					"Provide a non-empty translation in the culture's PO entry, then import and compile with Unreal."
			});
		// Source-level checks report once per line, under the line's source culture.
		if (culture.culture === sourceCulture) {
			if (
				notes.length === 0 &&
				line.manifest.every((entry) => localizationManifestNotes(entry).length === 0)
			)
				add({
					...base,
					ruleId: ruleIdOf("missing_translator_notes"),
					kind: "missing_translator_notes",
					actual: { noteCount: 0 },
					expectation: { minimumNotes: 1 },
					recovery:
						"Add translator context to a source occurrence or manifest-producing source."
				});
			// One finding per shared text, on the line whose identity sorts first.
			const duplicates = candidate ? context.duplicates.get(line.source) : undefined;
			if (
				duplicates &&
				duplicates.identityCount > 1 &&
				sameIdentity(duplicates.identities[0], line.identity)
			)
				add({
					...base,
					ruleId: ruleIdOf("duplicate_source"),
					kind: "duplicate_source",
					actual: duplicates,
					expectation: { reviewDistinctKeys: true },
					recovery:
						"Review whether these distinct identities need different context or should share a key. Equal text never links translations."
				});
			for (const text of sourceVariants ?? [line.source.trim() ? line.source : source])
				sourceTextFindings(text, base, add);
			const tables = new Set<string>();
			for (const unit of lineUnits)
				for (const occurrence of unit.occurrences)
					if (occurrence.location.kind === "string_table_entry")
						tables.add(occurrence.location.objectPath);
			if (tables.size > 1)
				add({
					...base,
					ruleId: ruleIdOf("string_table_key_collision"),
					kind: "string_table_key_collision",
					actual: {
						tables: [...tables].sort(byCodeUnit).slice(0, 16),
						tableCount: tables.size
					},
					expectation: { oneTablePerKey: true },
					recovery:
						"Give each String Table its own namespace or rename the key; Unreal keeps one entry per namespace and key."
				});
		}
		if (!line.manifest.length)
			checkDiagnostics.push({
				lineId: line.id,
				culture: culture.culture,
				code: "source_unavailable"
			});
		if (!comparable) {
			if (shipped.value === null)
				checkDiagnostics.push({
					lineId: line.id,
					culture: culture.culture,
					code: "translation_unavailable"
				});
			continue;
		}
		const sourcePattern = parseUnrealFormatPattern(source, culture.culture);
		const sourceModifiers = modifiers(sourcePattern);
		const patternIssues = (pattern: UnrealFormatPattern) => {
			for (const issue of pattern.issues)
				if (issue.code === "unsupported_culture" || issue.code === "syntax_limit")
					checkDiagnostics.push({
						lineId: line.id,
						culture: culture.culture,
						code: issue.code
					});
			return pattern.issues.filter(
				(issue) => issue.code !== "unsupported_culture" && issue.code !== "syntax_limit"
			);
		};
		const sourceIssues = patternIssues(sourcePattern);
		if (sourceIssues.length)
			add({
				...base,
				ruleId: ruleIdOf("argument_modifiers"),
				kind: "argument_modifiers",
				actual: { side: "source", issues: sourceIssues, modifiers: sourceModifiers },
				expectation: { modifiers: sourceModifiers },
				recovery:
					"Repair the source's modifier syntax and culture-required forms before translating it."
			});
		if (shipped.value === null) {
			checkDiagnostics.push({
				lineId: line.id,
				culture: culture.culture,
				code: "translation_unavailable"
			});
			continue;
		}
		const translation = shipped.value;
		if (
			manifestSource !== undefined &&
			shipped.origin === "archive" &&
			culture.archive &&
			culture.culture !== context.nativeCulture &&
			culture.facts.includes("needs_update")
		)
			add({
				...base,
				ruleId: ruleIdOf("outdated_translation"),
				kind: "outdated_translation",
				actual: { translatedSource: culture.archive.source.Text },
				expectation: { source: manifestSource },
				recovery:
					"Translate the current source text and import it; Unreal ships the source instead of a translation made for older text."
			});
		const escapeMatches = [...translation.matchAll(/\\[nrt]/gu)];
		if (escapeMatches.length)
			add({
				...base,
				ruleId: ruleIdOf("po_escape_safety"),
				kind: "po_escape_safety",
				actual: {
					positions: escapeMatches.map((match) => match.index),
					sequences: escapeMatches.map((match) => match[0])
				},
				expectation: { roundTripSafe: true },
				recovery:
					"Replace literal backslash control sequences with actual control characters or reword them before Unreal's PO round trip."
			});
		const expectedSpace = unrealWhitespace(source);
		const actualSpace = unrealWhitespace(translation);
		if (
			expectedSpace.leading !== actualSpace.leading ||
			expectedSpace.trailing !== actualSpace.trailing ||
			unrealUnsafeWhitespace(translation)
		)
			add({
				...base,
				ruleId: ruleIdOf("whitespace"),
				kind: "whitespace",
				actual: actualSpace,
				expectation: expectedSpace,
				recovery:
					"Preserve the source's intentional boundary whitespace; remove unsafe boundary spaces or tabs."
			});
		if (expectedSpace.lineBreaks !== actualSpace.lineBreaks)
			add({
				...base,
				ruleId: ruleIdOf("line_breaks"),
				kind: "line_breaks",
				actual: { lineBreaks: actualSpace.lineBreaks },
				expectation: { lineBreaks: expectedSpace.lineBreaks },
				recovery:
					"Use as many line breaks as the source, so the text keeps its layout in the same space."
			});
		if (!unrealRichTextValid(source, translation))
			add({
				...base,
				ruleId: ruleIdOf("rich_text"),
				kind: "rich_text",
				actual: unrealRichTextCounts(translation),
				expectation: unrealRichTextCounts(source),
				recovery:
					"Balance opening rich-text tags with </>, retaining intentional source imbalance."
			});
		const tags = compareRichTextTags(source, translation);
		if (tags && (tags.missing.length || tags.added.length))
			add({
				...base,
				ruleId: ruleIdOf("rich_text_tags"),
				kind: "rich_text_tags",
				actual: { tags: tags.translationTags, missing: tags.missing, added: tags.added },
				expectation: { tags: tags.sourceTags },
				recovery:
					"Keep the source's rich-text tags, such as <b>…</> and <img/>, around the matching words; don't add or drop any."
			});
		if (tags?.changed.length)
			add({
				...base,
				ruleId: ruleIdOf("rich_text_tag_case"),
				kind: "rich_text_tag_case",
				actual: { changed: tags.changed },
				expectation: { sameCase: true },
				recovery: "Spell rich-text tag names exactly as the source does."
			});
		const translationPattern = parseUnrealFormatPattern(translation, culture.culture);
		const expectedArgs = argumentNames(sourcePattern);
		const actualArgs = argumentNames(translationPattern);
		const canComparePattern =
			sourcePattern.compiled !== null && translationPattern.compiled !== null;
		const missing = argumentOrder(sourcePattern).filter((name) => !actualArgs.includes(name));
		const added = argumentOrder(translationPattern).filter(
			(name) => !expectedArgs.includes(name)
		);
		// A dropped and an added name pair up, in order of appearance, as a rename.
		const pairs = Math.min(missing.length, added.length);
		if (canComparePattern && pairs > 0) {
			const finding: Unrated<
				Extract<LocalizationQualityFinding, { kind: "format_argument_renamed" }>
			> = {
				...base,
				ruleId: ruleIdOf("format_argument_renamed"),
				kind: "format_argument_renamed",
				actual: {
					arguments: actualArgs,
					renamed: Array.from({ length: pairs }, (_, index) => ({
						from: added[index]!,
						to: missing[index]!
					}))
				},
				expectation: { arguments: expectedArgs },
				recovery:
					"Use the source's argument names unchanged; translate the words around {arguments}, never the names inside them."
			};
			const from = added[0];
			const to = missing[0];
			if (
				enabled.includes("format_argument_renamed") &&
				line.manifest.length > 0 &&
				!culture.unknownReasons.some(
					(reason) =>
						reason === "duplicate_manifest_identity" ||
						reason === "duplicate_archive_identity" ||
						reason === "duplicate_po_identity"
				) &&
				missing.length === 1 &&
				added.length === 1 &&
				from !== undefined &&
				to !== undefined
			) {
				const replacement = renameArgument(translation, from, to, culture.culture);
				if (
					replacement !== undefined &&
					JSON.stringify(
						argumentNames(parseUnrealFormatPattern(replacement, culture.culture))
					) === JSON.stringify(expectedArgs)
				) {
					const change = {
						target,
						culture: culture.culture,
						...line.identity,
						source,
						previousTranslation:
							culture.po?.msgstr["0"] ?? culture.archive?.translation.Text ?? null,
						translation: replacement
					};
					Object.assign(finding, { suggestedChange: change });
					changes.push(change);
				}
			}
			add(finding);
		}
		const dropped = missing.slice(pairs).sort(),
			extra = added.slice(pairs).sort();
		if (canComparePattern && (dropped.length || extra.length))
			add({
				...base,
				ruleId: ruleIdOf("format_arguments"),
				kind: "format_arguments",
				actual: { arguments: actualArgs, missing: dropped, added: extra },
				expectation: { arguments: expectedArgs },
				recovery:
					"Keep the source's case-sensitive format argument names in the translation, including arguments inside modifier forms."
			});
		const translationModifiers = modifiers(translationPattern);
		const actionable = patternIssues(translationPattern);
		if (
			actionable.length ||
			(canComparePattern &&
				JSON.stringify(sourceModifiers) !== JSON.stringify(translationModifiers))
		)
			add({
				...base,
				ruleId: ruleIdOf("argument_modifiers"),
				kind: "argument_modifiers",
				actual: {
					side: "translation",
					issues: actionable,
					modifiers: translationModifiers
				},
				expectation: { modifiers: sourceModifiers },
				recovery:
					"Repair modifier syntax and culture-required forms; preserve the source's argument modifiers."
			});
		const separator = context.segmentSeparator;
		if (separator !== undefined) {
			const expected = countOccurrences(source, separator),
				actual = countOccurrences(translation, separator);
			if (expected !== actual)
				add({
					...base,
					ruleId: ruleIdOf("segment_separator"),
					kind: "segment_separator",
					actual: { separator, count: actual },
					expectation: { separator, count: expected },
					recovery: `Keep each "${separator}" segment of the source in the translation, in the same order.`
				});
		}
		const outlier = lengthOutlier(
			source,
			translation,
			(sourceLength ??= visibleTextLength(source))
		);
		if (outlier)
			add({
				...base,
				ruleId: ruleIdOf("length_outlier"),
				kind: "length_outlier",
				actual: { length: outlier.length, ratio: outlier.ratio },
				expectation: {
					sourceLength: outlier.sourceLength,
					minimumRatio: Math.round(LENGTH_OUTLIER.minimumRatio * 100) / 100,
					maximumRatio: LENGTH_OUTLIER.maximumRatio
				},
				recovery:
					"Check that the translation belongs to this line and is complete; a translation this much shorter or longer is often another line's text."
			});
		const variants = candidate
			? context.translations.get(line.source)?.get(culture.culture)
			: undefined;
		if (
			variants &&
			translation !== "" &&
			(variants.majority === undefined || translation !== variants.majority)
		)
			add({
				...base,
				ruleId: ruleIdOf("inconsistent_translation"),
				kind: "inconsistent_translation",
				actual: {
					translation,
					variants: variants.variants.slice(0, 5),
					variantCount: variants.variants.length
				},
				expectation: { consistentTranslation: true },
				recovery:
					"Use the culture's usual translation of this text, or add translator notes that explain why this key differs."
			});
	}
}

/** Built-ins are read-only; proposals never modify evidence, corpus, PO or archives. */
export function checkLocalizationTarget(
	corpus: TextCorpus,
	join: LocalizationJoin,
	evidence: LocalizationTargetEvidence,
	options: LocalizationCheckOptions = {},
	ruleDocument?: GameTextRuleDocument
): LocalizationQualityReport {
	const enabled = enabledLocalizationChecks(join, evidence, options, ruleDocument);
	const findings: LocalizationQualityFinding[] = [];
	const checkDiagnostics: LocalizationCheckDiagnostic[] = [];
	const changes: LocalizationChange[] = [];
	const byUnit = new Map(corpus.units.map((unit) => [unit.id, unit]));
	const duplicates = localizationDuplicateSources();
	for (const line of join.lines)
		if (localizationDuplicateCandidate(line)) duplicates.add(line.source, line.identity!);
	const { shared } = duplicates.finish();
	const translations = localizationTranslationVariants(shared);
	if (enabled.includes("inconsistent_translation"))
		for (const line of join.lines) translations.add(line);
	const context: LocalizationLineCheckContext = {
		target: join.target,
		nativeCulture: join.nativeCulture,
		options,
		enabled,
		duplicates: shared,
		translations: translations.finish(),
		segmentSeparator: ruleDocument?.segmentSeparator
	};
	for (const line of [...join.lines].sort((a, b) => a.id.localeCompare(b.id)))
		checkLocalizationLine(line, () => localizationLineUnits(line, byUnit), context, {
			findings,
			checkDiagnostics,
			changes
		});
	findings.sort(compareLocalizationFindings);
	const files = localizationEvidenceFileStatuses(evidence);
	const policy =
		ruleDocument?.schemaVersion === 2
			? evaluateLocalizationPolicy(corpus, join, ruleDocument, options)
			: { findings: [], diagnostics: [] };
	const visible = withoutAcceptedFindings(
		join,
		[...findings, ...policy.findings],
		options.review
	);
	const combined = [...visible.findings].sort(compareReportedLocalizationFindings);
	const report = LocalizationQualityReport.make({
		schemaVersion: 1,
		ruleDocumentVersion: ruleDocument?.schemaVersion ?? 1,
		status: corpus.status,
		coverage: corpus.coverage,
		...textCorpusDiagnosticSummary(corpus.diagnostics),
		target: join.target,
		gatherEvidence: files,
		findings: combined,
		checkDiagnostics,
		roles: [],
		rules: [
			...(ruleDocument?.schemaVersion === 2
				? (ruleDocument.localizationRules ?? []).map((rule) => ({
						ruleId: rule.id,
						findingCount: visible.findings.filter(
							(finding) => finding.ruleId === rule.id
						).length
					}))
				: []),
			...enabled.map((id) => ({
				ruleId: ruleIdOf(id),
				findingCount: visible.findings.filter((finding) => finding.kind === id).length
			}))
		],
		changes: {
			schemaVersion: 1,
			provenance: {
				producer: "ue-shed.localization.checks",
				files: files.flatMap((file) => (file.provenance ? [file.provenance] : []))
			},
			changes
		}
	});
	if (ruleDocument?.schemaVersion === 2)
		Object.assign(report, { ruleDiagnostics: policy.diagnostics });
	if (options.review) Object.assign(report, { acceptedFindings: visible.accepted });
	return report;
}
