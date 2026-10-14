import { Schema } from "effect";
import {
	CultureCode,
	LocalizationTargetName,
	LocalizationChange,
	LocalizationChangeSet
} from "@ue-shed/localization/browser";
import { TextCorpus, TextUnitId } from "./schema.js";
import {
	TextQualityFindingId,
	TextQualityFocus,
	textQualityFindingId,
	textQualityQuery
} from "./quality-query.js";
import {
	TextQualityAffectedOccurrence,
	TextQualityRuleSummary,
	type TextQualityReport
} from "./quality-schema.js";
import {
	LocalizationCheckDiagnostic,
	type LocalizationQualityReport
} from "./localization-quality-schema.js";
import { LocalizationFocus, localizationFocusPage } from "./localization-view.js";
import {
	LocalizationUnknownReason,
	type LocalizationJoin,
	type LocalizationLine
} from "./localization-schema.js";
import { localizationShippedTranslation } from "./localization-shipped-translation.js";
import {
	LocalizationProgressCulture,
	type LocalizationProgressReport,
	type LocalizationBaseline
} from "./localization-reports.js";
import {
	LocalizationFileProblem,
	localizationEvidenceFolder,
	localizationFileProblems
} from "./localization-status.js";
import { textCountLabel } from "./csv.js";
import { textAssetName, spreadsheetCsv } from "./csv.js";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Offset = Schema.optionalKey(Count);
const Excerpt = Schema.String.check(Schema.isMaxLength(4096));
export const WorkspaceQualityFilter = Schema.Literals([
	"all",
	"character_budget",
	"terminology",
	"format_arguments",
	"argument_modifiers",
	"rich_text",
	"po_escape_safety",
	"whitespace",
	"empty_translation",
	"missing_translator_notes",
	"duplicate_source"
]);
export type WorkspaceQualityFilter = typeof WorkspaceQualityFilter.Type;
export const workspaceQualityLabels = {
	all: "All findings",
	character_budget: "Character limits",
	terminology: "Terminology",
	format_arguments: "Format arguments",
	argument_modifiers: "Plural and gender forms",
	rich_text: "Rich text tags",
	po_escape_safety: "Unsafe escapes",
	whitespace: "Whitespace",
	empty_translation: "Empty translation",
	missing_translator_notes: "No translator notes",
	duplicate_source: "Same text, different keys"
} satisfies Record<WorkspaceQualityFilter, string>;
const Selection = { target: LocalizationTargetName, culture: Schema.optionalKey(CultureCode) };
export const WorkspaceQualityRequest = Schema.Struct({
	...Selection,
	filter: WorkspaceQualityFilter,
	offset: Offset
});
export type WorkspaceQualityRequest = typeof WorkspaceQualityRequest.Type;
export const WorkspaceQualityFocusRequest = Schema.Struct({
	...Selection,
	id: TextQualityFindingId,
	occurrenceOffset: Offset,
	poContextOffset: Offset
});
export type WorkspaceQualityFocusRequest = typeof WorkspaceQualityFocusRequest.Type;
export const WorkspaceFinding = Schema.Struct({
	id: TextQualityFindingId,
	filter: WorkspaceQualityFilter,
	source: Schema.String.check(Schema.isMaxLength(512)),
	problem: Schema.String.check(Schema.isMaxLength(1024)),
	context: Schema.String.check(Schema.isMaxLength(1024)),
	culture: Schema.optionalKey(CultureCode)
});
export type WorkspaceFinding = typeof WorkspaceFinding.Type;
export const WorkspaceQualityPage = Schema.Struct({
	findings: Schema.Array(WorkspaceFinding).check(Schema.isMaxLength(50)),
	total: Count,
	counts: Schema.Record(WorkspaceQualityFilter, Count),
	nextOffset: Offset,
	suggestedFixCount: Count,
	limits: Schema.Array(
		Schema.Struct({ code: LocalizationCheckDiagnostic.fields.code, count: Count })
	).check(Schema.isMaxLength(32)),
	unsupportedRuleCultures: Count,
	rules: Schema.Array(TextQualityRuleSummary).check(Schema.isMaxLength(1032))
});
export type WorkspaceQualityPage = typeof WorkspaceQualityPage.Type;
/** File reports keep every matching finding; renderer pages remain bounded. */
export const WorkspaceQualityReport = WorkspaceQualityPage.mapFields(
	({ nextOffset: _offset, ...fields }) => ({
		...fields,
		findings: Schema.Array(WorkspaceFinding),
		corpusCoverage: TextCorpus.fields.coverage,
		status: TextCorpus.fields.status,
		target: WorkspaceQualityRequest.fields.target,
		culture: WorkspaceQualityRequest.fields.culture,
		filter: WorkspaceQualityRequest.fields.filter
	})
);
export type WorkspaceQualityReport = typeof WorkspaceQualityReport.Type;

const Failure = Schema.Struct({
	status: Schema.Literal("failed"),
	message: Schema.String,
	recovery: Schema.String
});
const NotReady = Schema.Struct({ status: Schema.Literal("not_ready") });
export const WorkspaceQualityResult = Schema.Union([
	NotReady,
	Failure,
	Schema.Struct({ status: Schema.Literal("ready"), page: WorkspaceQualityPage })
]);
export type WorkspaceQualityResult = typeof WorkspaceQualityResult.Type;
const BoundedChange = LocalizationChange.mapFields((fields) => ({
	...fields,
	source: Schema.String.check(Schema.isMaxLength(16384)),
	translation: Schema.String.check(Schema.isMaxLength(16384)),
	previousTranslation: Schema.NullOr(Schema.String.check(Schema.isMaxLength(16384)))
}));
const Changes = LocalizationChangeSet.mapFields((fields) => ({
	...fields,
	provenance: fields.provenance.mapFields((provenance) => ({
		...provenance,
		files: provenance.files.check(Schema.isMaxLength(0))
	})),
	changes: Schema.Array(BoundedChange).check(Schema.isMaxLength(100))
}));
export const WorkspaceChangesResult = Schema.Union([
	NotReady,
	Failure,
	Schema.Struct({
		status: Schema.Literal("ready"),
		document: Changes,
		remaining: Count
	})
]);
export type WorkspaceChangesResult = typeof WorkspaceChangesResult.Type;
const Range = Schema.Struct({ start: Count, end: Count });
export const WorkspaceLocalizationFindingFocus = Schema.Struct({
	kind: Schema.Literal("localization"),
	id: TextQualityFindingId,
	source: Excerpt,
	translation: Schema.NullOr(Excerpt),
	translationOrigin: Schema.Literals(["po", "archive", "absent"]),
	sourceRanges: Schema.Array(Range).check(Schema.isMaxLength(64)),
	translationRanges: Schema.Array(Range).check(Schema.isMaxLength(64)),
	truncated: Schema.Boolean,
	problem: WorkspaceFinding.fields.problem,
	recovery: Schema.String,
	check: WorkspaceQualityFilter,
	/** The rule a review file records when someone accepts this finding. */
	ruleId: Schema.String,
	culture: CultureCode,
	textUnitId: Schema.optionalKey(TextUnitId),
	affectedOccurrences: Schema.Array(TextQualityAffectedOccurrence).check(Schema.isMaxLength(50)),
	totalOccurrences: Count,
	nextOccurrenceOffset: Offset,
	translations: LocalizationFocus,
	suggestedChange: Schema.optionalKey(BoundedChange)
});
export type WorkspaceLocalizationFindingFocus = typeof WorkspaceLocalizationFindingFocus.Type;
export const WorkspaceQualityFocusResult = Schema.Union([
	NotReady,
	Failure,
	Schema.Struct({ status: Schema.Literal("not_found") }),
	Schema.Struct({
		status: Schema.Literal("found"),
		focus: Schema.Union([
			Schema.Struct({ kind: Schema.Literal("source"), focus: TextQualityFocus }),
			WorkspaceLocalizationFindingFocus
		])
	})
]);
export type WorkspaceQualityFocusResult = typeof WorkspaceQualityFocusResult.Type;
type Finding = LocalizationQualityReport["findings"][number];
type SourceFinding = TextQualityReport["findings"][number];
type RuleId = (typeof TextQualityRuleSummary.Type)["ruleId"];
/** A shown finding: the finding, its line when known, and the summary the list displays. */
export interface WorkspaceQualityItem {
	readonly finding: Finding | SourceFinding;
	readonly line: LocalizationLine | undefined;
	readonly summary: WorkspaceFinding;
}
export function workspaceQualityFilterOf(finding: Finding | SourceFinding): WorkspaceQualityFilter {
	if (finding.kind === "localization_character_budget") return "character_budget";
	if (finding.kind === "localization_terminology") return "terminology";
	return finding.kind;
}
function problem(finding: Finding): string {
	switch (finding.kind) {
		case "format_arguments":
			return [
				finding.actual.missing.length
					? "Missing " + finding.actual.missing.map((name) => "{" + name + "}").join(", ")
					: "",
				finding.actual.added.length
					? "uses " + finding.actual.added.map((name) => "{" + name + "}").join(", ")
					: ""
			]
				.filter(Boolean)
				.join(" · ");
		case "argument_modifiers":
			return "Check plural, ordinal and gender forms";
		case "rich_text":
			return "Unbalanced rich text tag";
		case "po_escape_safety":
			return "Unsafe escape " + finding.actual.sequences.join(", ");
		case "whitespace":
			return finding.actual.trailing !== finding.expectation.trailing
				? "Trailing space"
				: finding.actual.leading !== finding.expectation.leading
					? "Leading space"
					: "Whitespace or line breaks differ";
		case "empty_translation":
			return "Empty translation";
		case "missing_translator_notes":
			return "No translator notes";
		case "duplicate_source":
			return "Same text, different keys";
		case "character_budget":
		case "localization_character_budget":
			return (
				"Maximum " +
				textCountLabel(finding.expectation.maximumCharacters, "character") +
				" · " +
				textCountLabel(finding.actual.characterCount, "character")
			);
		case "terminology":
		case "localization_terminology":
			return finding.expectation.kind === "forbidden_term"
				? "Remove “" + finding.actual.term + "”"
				: "Prefer “" +
						finding.expectation.preferredTerm +
						"” · uses “" +
						finding.actual.term +
						"”";
	}
}
/** What tells localization findings apart. */
interface HashedLocalizationFinding {
	readonly lineId: string;
	readonly culture: string;
	readonly ruleId: string;
	readonly kind: string;
	readonly actual: object;
	readonly expectation: object;
}
/**
 * JSON with object keys sorted at every level: listed properties serialize in list order, so equal
 * values hash equally whether a schema or a check built them.
 */
function canonicalJson(finding: HashedLocalizationFinding): string {
	const values = [
		finding.lineId,
		finding.culture,
		finding.ruleId,
		finding.kind,
		finding.actual,
		finding.expectation
	];
	const keys = new Set<string>();
	JSON.stringify(values, (key, item) => {
		keys.add(key);
		return item;
	});
	return JSON.stringify(values, [...keys].sort());
}
/**
 * Two 32-bit lanes of a fast string hash over the finding's line, culture, rule, check and
 * observed and expected values. IDs stay stable while that text is unchanged.
 */
export function localizationFindingHash(
	finding: HashedLocalizationFinding
): readonly [number, number] {
	const text = canonicalJson(finding);
	let first = 0x811c9dc5,
		second = 0x9e3779b9;
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		first = Math.imul(first ^ code, 0x01000193);
		second = Math.imul(second ^ code, 0x5bd1e995);
		second ^= second >>> 15;
	}
	return [first >>> 0, second >>> 0];
}
export function localizationFindingId([first, second]: readonly [number, number]) {
	return TextQualityFindingId.make(
		"localization-finding:" +
			first.toString(16).padStart(8, "0") +
			second.toString(16).padStart(8, "0")
	);
}
/** The finding's suggested change when it fits a proposal; otherwise undefined. */
export function eligibleLocalizationChange(finding: Finding | SourceFinding) {
	return "suggestedChange" in finding &&
		finding.suggestedChange &&
		Schema.is(BoundedChange)(finding.suggestedChange)
		? finding.suggestedChange
		: undefined;
}
export function workspaceQualityItem(
	finding: Finding | SourceFinding,
	line: LocalizationLine | undefined
): WorkspaceQualityItem {
	const localized = "culture" in finding;
	const id = localized
		? localizationFindingId(localizationFindingHash(finding))
		: textQualityFindingId(finding);
	const location = finding.affectedOccurrences[0]?.location;
	const context =
		(location
			? textAssetName(location.objectPath)
			: (line?.manifest[0]?.path ?? "Source file")) +
		" · " +
		(localized
			? finding.identity.key
			: (line?.identity?.key ??
				(location?.kind === "string_table_entry" ? location.entryKey : finding.ruleId))) +
		" · " +
		workspaceQualityLabels[workspaceQualityFilterOf(finding)] +
		" · " +
		textCountLabel(finding.affectedOccurrences.length, "location");
	const summary: WorkspaceFinding = {
		id,
		filter: workspaceQualityFilterOf(finding),
		source: (localized
			? (line?.manifest[0]?.source.Text ?? line?.source ?? "")
			: finding.actual.source
		).slice(0, 512),
		problem: ((localized ? finding.culture + " · " : "") + problem(finding)).slice(0, 1024),
		context: context.slice(0, 1024),
		...(localized ? { culture: finding.culture } : undefined)
	};
	return { finding, line, summary };
}
function ranges(text: string, finding: Finding, side: "source" | "translation") {
	const matches: Array<{ start: number; end: number }> = [];
	const add = (start: number, end: number) => {
		if (matches.length < 64 && start < 4096 && end > start)
			matches.push({ start, end: Math.min(end, 4096) });
	};
	if (finding.kind === "format_arguments") {
		const names = side === "source" ? finding.actual.missing : finding.actual.added;
		for (const name of names) {
			const term = "{" + name + "}";
			let start = text.indexOf(term);
			while (start >= 0 && matches.length < 64) {
				add(start, start + term.length);
				start = text.indexOf(term, start + term.length);
			}
		}
	} else if (finding.kind === "localization_terminology" && side === "translation")
		add(finding.actual.start, finding.actual.end);
	else if (
		finding.kind === "rich_text" ||
		finding.kind === "argument_modifiers" ||
		finding.kind === "po_escape_safety" ||
		finding.kind === "whitespace"
	) {
		const pattern =
			finding.kind === "rich_text"
				? /<[^>]*>/gu
				: finding.kind === "argument_modifiers"
					? /\|(?:plural|ordinal|gender)\([^)]*\)/gu
					: finding.kind === "po_escape_safety"
						? /\\[nrt]/gu
						: /^\s+|\s+$|[\r\n]+/gu;
		for (const match of text.matchAll(pattern)) add(match.index, match.index + match[0].length);
	}
	return matches.sort((a, b) => a.start - b.start);
}

/** Localization findings in report order. Facts are cheap; only `items` reads lines. */
export interface LocalizationFindingList {
	readonly length: number;
	culture(position: number): CultureCode;
	filter(position: number): WorkspaceQualityFilter;
	ruleId(position: number): RuleId;
	eligible(position: number): boolean;
	/** The first position with this ID within the culture selection. */
	find(id: TextQualityFindingId, culture: CultureCode | undefined): number | undefined;
	items(positions: readonly number[]): readonly WorkspaceQualityItem[];
	/** Check diagnostic counts in first-seen order. */
	limits(
		culture: CultureCode | undefined
	): ReadonlyArray<{ code: LocalizationCheckDiagnostic["code"]; count: number }>;
}
export interface LocalizationQualityMetadata {
	readonly join: Pick<LocalizationJoin, "target" | "nativeCulture" | "cultures">;
	readonly rules: readonly RuleId[];
	readonly unsupportedRuleCultures: number;
	readonly status: TextCorpus["status"];
	readonly coverage: TextCorpus["coverage"];
	/** The line a source finding's unit belongs to, for its context. */
	readonly lineOfUnit: (id: TextUnitId) => LocalizationLine | undefined;
}

/** Findings and metadata a quality workspace reads, however they are stored. */
export interface LocalizationQuality {
	readonly findings: LocalizationFindingList;
	readonly metadata: LocalizationQualityMetadata;
}

/** A retained index; every page, type count and proposal uses the same culture/filter selection. */
export function localizationQualityWorkspace(
	source: TextQualityReport | undefined,
	report: LocalizationQualityReport,
	join: LocalizationJoin
) {
	return localizationQualityWorkspaceOf(source, localizationQuality(report, join));
}

/** The in-memory form: findings of a whole report, with the join their lines come from. */
export function localizationQuality(
	report: LocalizationQualityReport,
	join: LocalizationJoin
): LocalizationQuality {
	const lines = new Map(join.lines.map((line) => [line.id, line]));
	const units = new Map(
		join.lines.flatMap((line) =>
			line.origin.kind === "corpus"
				? line.origin.unitIds.map((id) => [id, line] as const)
				: []
		)
	);
	const items = report.findings.map((finding) =>
		workspaceQualityItem(
			finding,
			"culture" in finding ? lines.get(finding.lineId) : units.get(finding.textUnitId)
		)
	);
	return {
		findings: {
			length: items.length,
			culture: (position) => items[position]!.summary.culture!,
			filter: (position) => items[position]!.summary.filter,
			ruleId: (position) => items[position]!.finding.ruleId,
			eligible: (position) =>
				eligibleLocalizationChange(items[position]!.finding) !== undefined,
			find: (id, culture) => {
				const position = items.findIndex(
					({ summary }) => summary.id === id && (!culture || summary.culture === culture)
				);
				return position < 0 ? undefined : position;
			},
			items: (positions) => positions.map((position) => items[position]!),
			limits: (culture) => {
				const limits = new Map<LocalizationCheckDiagnostic["code"], number>();
				for (const diagnostic of report.checkDiagnostics) {
					if (!culture || diagnostic.culture === culture)
						limits.set(diagnostic.code, (limits.get(diagnostic.code) ?? 0) + 1);
				}
				return [...limits].map(([code, count]) => ({ code, count }));
			}
		},
		metadata: {
			join,
			rules: report.rules.map((rule) => rule.ruleId),
			unsupportedRuleCultures: report.ruleDiagnostics?.length ?? 0,
			status: report.status,
			coverage: report.coverage,
			lineOfUnit: (id) => units.get(id)
		}
	};
}

/** The workspace over any finding list. Source findings come first, then localization findings. */
export function localizationQualityWorkspaceOf(
	source: TextQualityReport | undefined,
	{ findings: list, metadata }: LocalizationQuality
) {
	const sourceQuery = source ? textQualityQuery(source) : undefined;
	const sourceItems = (source?.findings ?? []).map((finding) =>
		workspaceQualityItem(finding, metadata.lineOfUnit(finding.textUnitId))
	);
	const sourceCount = sourceItems.length,
		total = sourceCount + list.length;
	const inCulture = (request: { culture?: CultureCode | undefined }, position: number) =>
		position < sourceCount ||
		!request.culture ||
		list.culture(position - sourceCount) === request.culture;
	const filterAt = (position: number) =>
		position < sourceCount
			? sourceItems[position]!.summary.filter
			: list.filter(position - sourceCount);
	const ruleAt = (position: number) =>
		position < sourceCount
			? sourceItems[position]!.finding.ruleId
			: list.ruleId(position - sourceCount);
	const eligibleAt = (position: number) =>
		position < sourceCount
			? eligibleLocalizationChange(sourceItems[position]!.finding) !== undefined
			: list.eligible(position - sourceCount);
	const itemsAt = (positions: readonly number[]): WorkspaceQualityItem[] => {
		const localized = list.items(
			positions.filter((position) => position >= sourceCount).map((p) => p - sourceCount)
		);
		let next = 0;
		return positions.map((position) =>
			position < sourceCount ? sourceItems[position]! : localized[next++]!
		);
	};
	/** Summaries in batches, so a large export never holds every finding and line at once. */
	const summariesAt = (positions: readonly number[]) => {
		const summaries: WorkspaceFinding[] = [];
		for (let start = 0; start < positions.length; start += 2048)
			for (const item of itemsAt(positions.slice(start, start + 2048)))
				summaries.push(item.summary);
		return summaries;
	};
	const matched = (request: WorkspaceQualityRequest, wanted = (_position: number) => true) => {
		const positions: number[] = [];
		for (let position = 0; position < total; position++)
			if (
				inCulture(request, position) &&
				(request.filter === "all" || request.filter === filterAt(position)) &&
				wanted(position)
			)
				positions.push(position);
		return positions;
	};
	const search = (request: WorkspaceQualityRequest): WorkspaceQualityPage => {
		const typeCounts = new Map<WorkspaceQualityFilter, number>();
		const ruleCounts = new Map<string, number>();
		const offset = request.offset ?? 0,
			page: number[] = [];
		let cultureCount = 0,
			matchedCount = 0,
			suggestedFixCount = 0;
		for (let position = 0; position < total; position++) {
			if (!inCulture(request, position)) continue;
			cultureCount++;
			const filter = filterAt(position),
				rule = ruleAt(position);
			typeCounts.set(filter, (typeCounts.get(filter) ?? 0) + 1);
			ruleCounts.set(rule, (ruleCounts.get(rule) ?? 0) + 1);
			if (request.filter !== "all" && request.filter !== filter) continue;
			if (matchedCount >= offset && matchedCount < offset + 50) page.push(position);
			matchedCount++;
			if (eligibleAt(position)) suggestedFixCount++;
		}
		const counts = Schema.decodeUnknownSync(WorkspaceQualityPage.fields.counts)(
			Object.fromEntries(
				WorkspaceQualityFilter.literals.map((filter) => [
					filter,
					filter === "all" ? cultureCount : (typeCounts.get(filter) ?? 0)
				])
			)
		);
		return {
			counts,
			limits: [...list.limits(request.culture)],
			unsupportedRuleCultures: metadata.unsupportedRuleCultures,
			total: matchedCount,
			findings: itemsAt(page).map((item) => item.summary),
			suggestedFixCount,
			rules: [...(source?.rules ?? []).map((rule) => rule.ruleId), ...metadata.rules].map(
				(ruleId) => ({ ruleId, findingCount: ruleCounts.get(ruleId) ?? 0 })
			),
			...(offset + 50 < matchedCount ? { nextOffset: offset + 50 } : undefined)
		};
	};
	return {
		search,
		export(request: WorkspaceQualityRequest): WorkspaceQualityReport {
			const { nextOffset: _offset, ...page } = search(request);
			return {
				...page,
				findings: summariesAt(matched(request)),
				corpusCoverage: metadata.coverage,
				status: metadata.status,
				target: request.target,
				filter: request.filter,
				...(request.culture ? { culture: request.culture } : undefined)
			};
		},
		focus(request: WorkspaceQualityFocusRequest): WorkspaceQualityFocusResult {
			let item = sourceItems.find(({ summary }) => summary.id === request.id);
			if (!item) {
				const position = list.find(request.id, request.culture);
				item = position === undefined ? undefined : list.items([position])[0];
			}
			if (!item) return { status: "not_found" };
			const { finding, line, summary } = item;
			if (!("culture" in finding)) {
				const offset = request.occurrenceOffset ?? 0;
				const previous = offset ? finding.affectedOccurrences[offset - 1]?.id : undefined;
				const focus = sourceQuery?.focus({
					id: summary.id,
					pageSize: 50,
					...(previous ? { occurrenceCursor: previous } : undefined)
				});
				return focus
					? { status: "found", focus: { kind: "source", focus } }
					: { status: "not_found" };
			}
			if (!line) return { status: "not_found" };
			const mark = line.cultures.find((mark) => mark.culture === finding.culture);
			const sourceText = line.manifest[0]?.source.Text ?? line.source;
			const translation = mark ? localizationShippedTranslation(mark).value : null;
			const detail = localizationFocusPage(
				metadata.join,
				{
					...line,
					cultures: line.cultures.filter((mark) => mark.culture === finding.culture)
				},
				{
					target: request.target,
					selection: { kind: "line", id: line.id },
					locationOffset: request.occurrenceOffset ?? 0,
					poContextOffset: request.poContextOffset ?? 0
				}
			);
			const change = eligibleLocalizationChange(finding);
			return {
				status: "found",
				focus: {
					kind: "localization",
					id: summary.id,
					source: sourceText.slice(0, 4096),
					translation: translation?.slice(0, 4096) ?? null,
					translationOrigin: finding.translationOrigin,
					sourceRanges: ranges(sourceText, finding, "source"),
					translationRanges: ranges(translation ?? "", finding, "translation"),
					truncated: sourceText.length > 4096 || (translation?.length ?? 0) > 4096,
					problem: summary.problem,
					recovery: finding.recovery,
					check: summary.filter,
					ruleId: finding.ruleId,
					culture: finding.culture,
					affectedOccurrences: finding.affectedOccurrences.slice(
						request.occurrenceOffset ?? 0,
						(request.occurrenceOffset ?? 0) + 50
					),
					totalOccurrences: finding.affectedOccurrences.length,
					...((request.occurrenceOffset ?? 0) + 50 < finding.affectedOccurrences.length
						? { nextOccurrenceOffset: (request.occurrenceOffset ?? 0) + 50 }
						: undefined),
					translations: detail,
					...(line.origin.kind === "corpus" && line.origin.unitIds[0]
						? { textUnitId: line.origin.unitIds[0] }
						: undefined),
					...(change ? { suggestedChange: change } : undefined)
				}
			};
		},
		changes(request: WorkspaceQualityRequest): WorkspaceChangesResult {
			const changes: LocalizationChange[] = [];
			const seen = new Set<string>();
			let remaining = 0,
				bytes = 0,
				read = 0;
			const eligible = matched(request, eligibleAt);
			// Only format-argument findings suggest changes: one per line and culture, and a line's
			// identity is unique, so changes past the first 100 are counted without reading lines.
			while (read < eligible.length && changes.length < 100) {
				const batch = itemsAt(eligible.slice(read, read + 128));
				read += batch.length;
				for (const { finding } of batch) {
					const change = eligibleLocalizationChange(finding);
					if (!change) continue;
					const key = JSON.stringify([
						change.target,
						change.culture,
						change.namespace,
						change.key
					]);
					if (seen.has(key)) continue;
					seen.add(key);
					const size = new TextEncoder().encode(JSON.stringify(change)).length;
					if (changes.length === 100 || bytes + size > 1_000_000) {
						remaining++;
						continue;
					}
					changes.push(change);
					bytes += size;
				}
			}
			remaining += eligible.length - read;
			// File authority stays in the host. A proposal records complete change identities, without filesystem paths.
			return {
				status: "ready",
				document: {
					schemaVersion: 1,
					provenance: { producer: "ue-shed.localization.checks", files: [] },
					changes
				},
				remaining
			};
		}
	};
}

export const WorkspaceReportRequest = Schema.Struct({
	target: LocalizationTargetName,
	offset: Offset
});
export type WorkspaceReportRequest = typeof WorkspaceReportRequest.Type;
const Words = Schema.NullOr(Count);
export const WorkspaceReportRow = Schema.Struct({
	culture: CultureCode,
	translatedLines: Words,
	totalLines: Count,
	linesPercent: Schema.NullOr(Schema.Number),
	wordsPercent: Schema.NullOr(Schema.Number),
	wordsNeedingWork: Words,
	notSynced: Count,
	/** Present once the project has a review file for the target. */
	reviewedLines: Schema.optionalKey(Count),
	proofreadLines: Schema.optionalKey(Count),
	newWords: Schema.optionalKey(Words),
	changedWords: Schema.optionalKey(Words)
});
export type WorkspaceReportRow = typeof WorkspaceReportRow.Type;
export const WorkspaceReportPage = Schema.Struct({
	target: LocalizationTargetName,
	rows: Schema.Array(WorkspaceReportRow).check(Schema.isMaxLength(50)),
	totalCultures: Count,
	nextOffset: Offset,
	coverage: TextCorpus.fields.coverage,
	gatherFilesRead: Count,
	/** Every evidence file that failed, including files the working copy does not have. */
	gatherFilesFailed: Count,
	/** The failed files that are absent from the working copy rather than unreadable. */
	gatherFilesMissing: Schema.optionalKey(Count),
	/** The folder Game Text looked in for the target's evidence files. */
	localizationFolder: Schema.optionalKey(Schema.String),
	/** Failed evidence files, missing or unreadable, with their paths and error codes. */
	gatherFileProblems: Schema.optionalKey(
		Schema.Array(LocalizationFileProblem).check(Schema.isMaxLength(50))
	),
	wordCountUnknown: Count,
	unknownReasons: LocalizationProgressCulture.fields.unknownReasons,
	baseline: Schema.optionalKey(
		Schema.Struct({
			target: LocalizationTargetName,
			createdAt: Schema.String,
			/** Lines since the baseline: new keys, removed keys, changed keys and changed source. */
			since: Schema.optionalKey(
				Schema.Struct({ added: Count, removed: Count, keyChanged: Count, changed: Count })
			)
		})
	)
});
export type WorkspaceReportPage = typeof WorkspaceReportPage.Type;
export const WorkspaceReportResult = Schema.Union([
	NotReady,
	Failure,
	Schema.Struct({ status: Schema.Literal("ready"), page: WorkspaceReportPage })
]);
export type WorkspaceReportResult = typeof WorkspaceReportResult.Type;
export const WorkspaceReportFileRequest = Schema.Struct({
	target: LocalizationTargetName,
	operation: Schema.Literals(["save_baseline", "compare_baseline", "export_csv"])
});
export type WorkspaceReportFileRequest = typeof WorkspaceReportFileRequest.Type;
export const WorkspaceReportFileResult = Schema.Union([
	NotReady,
	Failure,
	Schema.Struct({ status: Schema.Literal("cancelled") }),
	Schema.Struct({ status: Schema.Literal("saved"), message: Schema.String }),
	Schema.Struct({ status: Schema.Literal("compared"), page: WorkspaceReportPage })
]);
export type WorkspaceReportFileResult = typeof WorkspaceReportFileResult.Type;
export function localizationReportPage(
	report: LocalizationProgressReport,
	native: string | null,
	request: WorkspaceReportRequest,
	baseline?: LocalizationBaseline
): WorkspaceReportPage {
	const cultures = [...report.cultures].sort(
		(a, b) => Number(b.culture === native) - Number(a.culture === native)
	);
	const offset = request.offset ?? 0;
	const problems = localizationFileProblems(report.gatherEvidence);
	const folder = localizationEvidenceFolder(report.gatherEvidence);
	const reasons = Schema.decodeUnknownSync(WorkspaceReportPage.fields.unknownReasons)(
		Object.fromEntries(
			LocalizationUnknownReason.literals.map((reason) => [
				reason,
				cultures.reduce((sum, culture) => sum + culture.unknownReasons[reason], 0)
			])
		)
	);
	return {
		target: report.target,
		rows: cultures.slice(offset, offset + 50).map((culture) => ({
			culture: culture.culture,
			translatedLines: culture.upToDateArchive.lines,
			totalLines: culture.total.lines,
			linesPercent: culture.translatedPercent.lines,
			wordsPercent: culture.translatedPercent.words,
			wordsNeedingWork:
				culture.total.sourceWords !== null && culture.upToDateArchive.sourceWords !== null
					? Math.max(0, culture.total.sourceWords - culture.upToDateArchive.sourceWords)
					: null,
			notSynced: culture.notSynced.lines,
			...(culture.reviewed === "not_tracked" || culture.proofread === "not_tracked"
				? undefined
				: {
						reviewedLines: culture.reviewed.lines,
						proofreadLines: culture.proofread.lines
					}),
			...(culture.baselineDelta
				? {
						newWords: culture.baselineDelta.addedCounts.sourceWords,
						changedWords: culture.baselineDelta.changedCounts.sourceWords
					}
				: undefined)
		})),
		totalCultures: cultures.length,
		coverage: report.coverage,
		gatherFilesRead: report.gatherEvidence.filter((file) => file.status === "read").length,
		gatherFilesFailed: problems.length,
		gatherFilesMissing: problems.filter((problem) => problem.state === "missing").length,
		...(folder === undefined ? undefined : { localizationFolder: folder }),
		...(problems.length > 0 ? { gatherFileProblems: problems.slice(0, 50) } : undefined),
		wordCountUnknown: report.wordCountDiagnostics.length,
		unknownReasons: reasons,
		...(offset + 50 < cultures.length ? { nextOffset: offset + 50 } : undefined),
		...(baseline
			? {
					baseline: {
						target: baseline.target,
						createdAt: baseline.provenance.createdAt,
						...(report.cultures[0]?.baselineDelta
							? {
									since: {
										added: report.cultures[0].baselineDelta.addedCounts.lines,
										removed:
											report.cultures[0].baselineDelta.removedCounts.lines,
										keyChanged:
											report.cultures[0].baselineDelta.keyChangedCounts.lines,
										changed:
											report.cultures[0].baselineDelta.changedCounts.lines
									}
								}
							: undefined)
					}
				}
			: undefined)
	};
}
export function localizationReportCsv(
	pages: readonly WorkspaceReportRow[],
	baseline = false
): string {
	const headers = [
		"Culture",
		"Lines translated",
		"Total lines",
		"% translated by lines",
		"% translated by words",
		"Words needing work",
		"Not synced"
	];
	const reviewed = pages.some((row) => row.reviewedLines !== undefined);
	if (reviewed) headers.push("Lines reviewed", "Lines proofread");
	if (baseline) headers.push("New words", "Changed words");
	return spreadsheetCsv([
		headers,
		...pages.map((row) => {
			const cells: Array<string | number> = [
				row.culture,
				row.translatedLines ?? "Unknown",
				row.totalLines,
				row.linesPercent ?? "Unknown",
				row.wordsPercent ?? "Unknown",
				row.wordsNeedingWork ?? "Unknown",
				row.notSynced
			];
			if (reviewed) cells.push(row.reviewedLines ?? 0, row.proofreadLines ?? 0);
			if (baseline) cells.push(row.newWords ?? "Unknown", row.changedWords ?? "Unknown");
			return cells;
		})
	]);
}

/** A spreadsheet of the same finding summaries the quality list displays. */
export function workspaceQualityCsv(report: WorkspaceQualityReport): string {
	return spreadsheetCsv([
		["Target", "Culture", "Check", "Source", "Problem", "Context", "Finding ID", "Scan status"],
		...report.findings.map((finding) => [
			report.target,
			finding.culture ?? "Source",
			workspaceQualityLabels[finding.filter],
			finding.source,
			finding.problem,
			finding.context,
			finding.id,
			report.status
		])
	]);
}
