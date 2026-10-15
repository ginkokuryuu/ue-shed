import { textCorpusDiagnosticSummary } from "./corpus-summary.js";
import type {
	LocalizationChangeSet,
	LocalizationIdentity,
	LocalizationTargetEvidence
} from "@ue-shed/localization/browser";
import { LocalizationCheckId } from "./localization-check-ids.js";
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
	parseUnrealFormatPattern,
	unrealRichTextCounts,
	unrealRichTextValid,
	unrealWhitespace,
	unrealUnsafeWhitespace,
	type UnrealFormatPattern,
	type UnrealModifierIdentity
} from "./unreal-text-syntax.js";

type FindingBase = Pick<
	LocalizationQualityFinding,
	| "lineId"
	| "target"
	| "culture"
	| "identity"
	| "affectedOccurrences"
	| "manifestLocations"
	| "translationOrigin"
>;
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
	readonly enabled: readonly LocalizationCheckId[];
	/** Shared sources by text; only sources with more than one identity are needed. */
	readonly duplicates: ReadonlyMap<string, DuplicateSourceActual>;
}

export interface LocalizationLineCheckOutput {
	readonly findings: LocalizationQualityFinding[];
	readonly checkDiagnostics: LocalizationCheckDiagnostic[];
	readonly changes: LocalizationChange[];
}

/**
 * The culture a line's source-level findings (`missing_translator_notes`, `duplicate_source`) are
 * reported under, once per line: the target's native culture when the line has it in the target,
 * otherwise the first of its cultures in the target by code.
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
): readonly LocalizationCheckId[] {
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
	return LocalizationCheckId.literals.filter(
		(id) => !disabled.has(id) && (!options.checks || options.checks.includes(id))
	);
}

/** Lines with an identity, text and at least one culture in the target can share a source. */
export function localizationDuplicateCandidate(line: LocalizationLine): boolean {
	return (
		line.identity !== null &&
		line.source.trim().length > 0 &&
		!line.cultures.every((culture) => culture.state === "outside_target")
	);
}

/**
 * Groups candidate lines by source. Identities are sorted; the first five are kept. Identities
 * that compare equal keep their lines' join order: the order they are added in, unless the caller
 * adds them in another order and passes each line's position in the join.
 */
export function localizationDuplicateSources() {
	// Identity and join position, alternating; no object per line.
	const groups = new Map<string, Array<LocalizationIdentity | number>>();
	let added = 0;
	return {
		add(source: string, identity: LocalizationIdentity, joinPosition = added) {
			added++;
			const group = groups.get(source);
			if (group) group.push(identity, joinPosition);
			else groups.set(source, [identity, joinPosition]);
		},
		finish(): ReadonlyMap<string, DuplicateSourceActual> {
			const shared = new Map<string, DuplicateSourceActual>();
			for (const [source, group] of groups) {
				if (group.length < 4) continue;
				// SAFETY: `add` is the only writer and pushes an identity, then its position.
				const identities = Array.from({ length: group.length / 2 }, (_, index) => ({
					identity: group[index * 2] as LocalizationIdentity,
					position: group[index * 2 + 1] as number
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
			}
			groups.clear();
			return shared;
		}
	};
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

/** One line's built-in findings, check diagnostics and suggested changes, in check order. */
export function checkLocalizationLine(
	line: LocalizationLine,
	units: () => readonly TextUnit[],
	context: LocalizationLineCheckContext,
	{ findings, checkDiagnostics, changes }: LocalizationLineCheckOutput
): void {
	const { target, options, enabled } = context;
	for (const culture of [...line.cultures].sort((a, b) => a.culture.localeCompare(b.culture))) {
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
	if (!line.identity || line.source.trim().length === 0) return;
	const lineUnits = units();
	const affectedOccurrences: TextQualityAffectedOccurrence[] = lineUnits
		.flatMap((unit) =>
			unit.occurrences.map((occurrence) => ({
				id: occurrence.id,
				packageFile: occurrence.packageFile,
				location: occurrence.location
			}))
		)
		.sort((a, b) => a.id.localeCompare(b.id));
	const notes = lineUnits
		.flatMap((unit) => unit.occurrences.map((occurrence) => occurrence.devNotes))
		.filter((note) => note.trim().length > 0);
	const source = line.manifest[0]?.source.Text ?? line.source;
	const sourceCulture = localizationSourceCulture(line, context.nativeCulture);
	for (const culture of [...line.cultures].sort((a, b) => a.culture.localeCompare(b.culture))) {
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
			manifestLocations: [...new Set(line.manifest.map((entry) => entry.path))].sort(),
			translationOrigin: shipped.origin
		};
		const add = (finding: LocalizationQualityFinding) => {
			if (enabled.includes(finding.kind)) findings.push(finding);
		};
		const ruleId = (id: LocalizationCheckId) => TextQualityRuleId.make(`localization.${id}`);
		const emptyPO = culture.po?.msgstr["0"] === "";
		const emptyArchive = culture.archive?.translation.Text === "";
		if (emptyPO || emptyArchive)
			add({
				...base,
				translationOrigin: emptyPO ? "po" : "archive",
				ruleId: ruleId("empty_translation"),
				kind: "empty_translation",
				actual: { entryExists: true, translation: "" },
				expectation: { nonEmptyTranslation: true },
				recovery:
					"Provide a non-empty translation in the culture's PO entry, then import and compile with Unreal."
			});
		// Source-level checks report once per line, under the line's source culture.
		const sourceLevel = culture.culture === sourceCulture;
		if (
			sourceLevel &&
			notes.length === 0 &&
			line.manifest.every((entry) => localizationManifestNotes(entry).length === 0)
		)
			add({
				...base,
				ruleId: ruleId("missing_translator_notes"),
				kind: "missing_translator_notes",
				actual: { noteCount: 0 },
				expectation: { minimumNotes: 1 },
				recovery:
					"Add translator context to a source occurrence or manifest-producing source."
			});
		const duplicates = sourceLevel ? context.duplicates.get(line.source) : undefined;
		if (duplicates && duplicates.identityCount > 1)
			add({
				...base,
				ruleId: ruleId("duplicate_source"),
				kind: "duplicate_source",
				actual: duplicates,
				expectation: { reviewDistinctKeys: true },
				recovery:
					"Review whether these distinct identities need different context or should share a key. Equal text never links translations."
			});
		if (!line.manifest.length)
			checkDiagnostics.push({
				lineId: line.id,
				culture: culture.culture,
				code: "source_unavailable"
			});
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
				ruleId: ruleId("argument_modifiers"),
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
		const escapeMatches = [...translation.matchAll(/\\[nrt]/gu)];
		if (escapeMatches.length)
			add({
				...base,
				ruleId: ruleId("po_escape_safety"),
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
			JSON.stringify(expectedSpace) !== JSON.stringify(actualSpace) ||
			unrealUnsafeWhitespace(translation)
		)
			add({
				...base,
				ruleId: ruleId("whitespace"),
				kind: "whitespace",
				actual: actualSpace,
				expectation: expectedSpace,
				recovery:
					"Preserve the source's intentional boundary whitespace and line breaks; remove unsafe boundary spaces or tabs."
			});
		if (!unrealRichTextValid(source, translation))
			add({
				...base,
				ruleId: ruleId("rich_text"),
				kind: "rich_text",
				actual: unrealRichTextCounts(translation),
				expectation: unrealRichTextCounts(source),
				recovery:
					"Balance opening rich-text tags with </>, retaining intentional source imbalance."
			});
		const translationPattern = parseUnrealFormatPattern(translation, culture.culture);
		const expectedArgs = argumentNames(sourcePattern);
		const actualArgs = argumentNames(translationPattern);
		const canComparePattern =
			sourcePattern.compiled !== null && translationPattern.compiled !== null;
		const missing = expectedArgs.filter((argument) => !actualArgs.includes(argument));
		const added = actualArgs.filter((argument) => !expectedArgs.includes(argument));
		if (canComparePattern && (missing.length || added.length)) {
			const finding: Extract<LocalizationQualityFinding, { kind: "format_arguments" }> = {
				...base,
				ruleId: ruleId("format_arguments"),
				kind: "format_arguments",
				actual: { arguments: actualArgs, missing, added },
				expectation: { arguments: expectedArgs },
				recovery:
					"Keep the source's case-sensitive format argument names in the translation, including arguments inside modifier forms."
			};
			const from = added[0];
			const to = missing[0];
			if (
				enabled.includes("format_arguments") &&
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
		const translationModifiers = modifiers(translationPattern);
		const actionable = patternIssues(translationPattern);
		if (
			actionable.length ||
			(canComparePattern &&
				JSON.stringify(sourceModifiers) !== JSON.stringify(translationModifiers))
		)
			add({
				...base,
				ruleId: ruleId("argument_modifiers"),
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
	const context = {
		target: join.target,
		nativeCulture: join.nativeCulture,
		options,
		enabled,
		duplicates: duplicates.finish()
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
				ruleId: TextQualityRuleId.make(`localization.${id}`),
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
