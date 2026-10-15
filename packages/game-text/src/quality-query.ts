import { Schema } from "effect";
import {
	TextQualityAffectedOccurrence,
	TextQualityRoleSummary,
	TextQualityRuleSummary,
	type TextQualityFinding,
	type TextQualityReport
} from "./quality-schema.js";
import { GameTextRuleDocument } from "./quality-rules-v2.js";
import { textCountLabel } from "./csv.js";
import { TextCorpus, TextLocation, TextOccurrenceId, TextUnitId } from "./schema.js";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const PageSize = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }));

export const TextQualityFindingId = Schema.String.pipe(Schema.brand("TextQualityFindingId"));
export type TextQualityFindingId = Schema.Schema.Type<typeof TextQualityFindingId>;
export const makeTextQualityFindingId = TextQualityFindingId.make;

export const TextQualityFindingKind = Schema.Literals(["character_budget", "terminology"]);
export type TextQualityFindingKind = Schema.Schema.Type<typeof TextQualityFindingKind>;

export const TextQualityFilter = Schema.Literals(["all", "character_budget", "terminology"]);
export type TextQualityFilter = Schema.Schema.Type<typeof TextQualityFilter>;

export const TextQualityQuerySummary = Schema.Struct({
	characterBudgetCount: Count,
	coverage: TextCorpus.fields.coverage,
	diagnosticCount: Count,
	findingCount: Count,
	roles: Schema.Array(TextQualityRoleSummary),
	rules: Schema.Array(TextQualityRuleSummary),
	ruleDocumentVersion: Schema.Literals([1, 2]),
	schemaVersion: Schema.Literal(1),
	status: TextCorpus.fields.status,
	terminologyCount: Count
});
export type TextQualityQuerySummary = Schema.Schema.Type<typeof TextQualityQuerySummary>;

/**
 * Whether the host keeps a standalone rules file it can save these rules to. Hosts report only
 * this fact; the file's path never crosses the result.
 */
export const TextQualityRuleFile = Schema.Literals(["attached", "none"]);
export type TextQualityRuleFile = Schema.Schema.Type<typeof TextQualityRuleFile>;

export const TextQualityQueryRunResult = Schema.Union([
	Schema.Struct({
		document: GameTextRuleDocument,
		status: Schema.Literal("completed"),
		summary: TextQualityQuerySummary,
		ruleFile: Schema.optionalKey(TextQualityRuleFile)
	}),
	Schema.Struct({ status: Schema.Literal("cancelled") }),
	Schema.Struct({ status: Schema.Literal("not_ready") }),
	Schema.Struct({
		status: Schema.Literal("failed"),
		error: Schema.Struct({
			code: Schema.Literals([
				"invalid_rules",
				"read_failed",
				"contract_failure",
				"already_exists",
				"write_failed"
			]),
			message: Schema.String,
			recovery: Schema.String,
			retrySafe: Schema.Boolean
		})
	})
]);
export type TextQualityQueryRunResult = Schema.Schema.Type<typeof TextQualityQueryRunResult>;
export const decodeTextQualityQueryRunResult =
	Schema.decodeUnknownEffect(TextQualityQueryRunResult);

export const TextQualityRuleUpdateResult = Schema.Union([
	Schema.Struct({
		document: GameTextRuleDocument,
		status: Schema.Literal("completed"),
		summary: TextQualityQuerySummary,
		ruleFile: Schema.optionalKey(TextQualityRuleFile)
	}),
	Schema.Struct({ status: Schema.Literal("not_ready") }),
	Schema.Struct({
		status: Schema.Literal("failed"),
		error: Schema.Struct({
			code: Schema.Literals(["invalid_rules", "write_failed", "contract_failure"]),
			message: Schema.String,
			recovery: Schema.String,
			retrySafe: Schema.Boolean
		})
	})
]);
export type TextQualityRuleUpdateResult = Schema.Schema.Type<typeof TextQualityRuleUpdateResult>;
export const decodeTextQualityRuleUpdateResult = Schema.decodeUnknownEffect(
	TextQualityRuleUpdateResult
);

export const TextQualityFindingSummary = Schema.Struct({
	actual: Schema.String.check(Schema.isMaxLength(512)),
	expectation: Schema.String.check(Schema.isMaxLength(512)),
	id: TextQualityFindingId,
	kind: TextQualityFindingKind,
	location: Schema.optional(TextLocation),
	occurrenceCount: Count,
	recovery: Schema.String.check(Schema.isMaxLength(2048)),
	role: Schema.String,
	ruleId: Schema.String,
	sourceExcerpt: Schema.String.check(Schema.isMaxLength(512)),
	textUnitId: TextUnitId
});
export type TextQualityFindingSummary = Schema.Schema.Type<typeof TextQualityFindingSummary>;

export const TextQualitySearchRequest = Schema.Struct({
	cursor: Schema.optional(TextQualityFindingId),
	filter: TextQualityFilter,
	pageSize: PageSize
});
export type TextQualitySearchRequest = Schema.Schema.Type<typeof TextQualitySearchRequest>;

export const TextQualitySearchPage = Schema.Struct({
	findings: Schema.Array(TextQualityFindingSummary).check(Schema.isMaxLength(50)),
	nextCursor: Schema.optional(TextQualityFindingId),
	total: Count
});
export type TextQualitySearchPage = Schema.Schema.Type<typeof TextQualitySearchPage>;

export const TextQualitySearchResult = Schema.Union([
	Schema.Struct({ status: Schema.Literal("ready"), page: TextQualitySearchPage }),
	Schema.Struct({ status: Schema.Literal("not_ready") })
]);
export type TextQualitySearchResult = Schema.Schema.Type<typeof TextQualitySearchResult>;
export const decodeTextQualitySearchResult = Schema.decodeUnknownEffect(TextQualitySearchResult);

export const TextQualityFocusRequest = Schema.Struct({
	id: TextQualityFindingId,
	occurrenceCursor: Schema.optional(TextOccurrenceId),
	pageSize: PageSize
});
export type TextQualityFocusRequest = Schema.Schema.Type<typeof TextQualityFocusRequest>;

const FocusBase = {
	affectedOccurrences: Schema.Array(TextQualityAffectedOccurrence).check(Schema.isMaxLength(50)),
	id: TextQualityFindingId,
	nextOccurrenceCursor: Schema.optional(TextOccurrenceId),
	recovery: Schema.String,
	role: Schema.String,
	ruleId: Schema.String,
	sourceExcerpt: Schema.String.check(Schema.isMaxLength(4096)),
	sourceOffset: Count,
	sourceTruncated: Schema.Boolean,
	textUnitId: TextUnitId,
	totalOccurrences: Count
};

export const TextQualityFocus = Schema.Union([
	Schema.Struct({
		...FocusBase,
		actual: Schema.Struct({ characterCount: Count, kind: Schema.Literal("character_count") }),
		expectation: Schema.Struct({
			kind: Schema.Literal("maximum_characters"),
			maximumCharacters: Schema.Int.check(Schema.isGreaterThan(0))
		}),
		kind: Schema.Literal("character_budget")
	}),
	Schema.Struct({
		...FocusBase,
		actual: Schema.Struct({
			end: Count,
			kind: Schema.Literal("terminology_match"),
			start: Count,
			term: Schema.String
		}),
		expectation: Schema.Union([
			Schema.Struct({ kind: Schema.Literal("forbidden_term"), term: Schema.String }),
			Schema.Struct({
				discouragedTerm: Schema.String,
				kind: Schema.Literal("preferred_term"),
				preferredTerm: Schema.String
			})
		]),
		kind: Schema.Literal("terminology")
	})
]);
export type TextQualityFocus = Schema.Schema.Type<typeof TextQualityFocus>;

export const TextQualityFocusResult = Schema.Union([
	Schema.Struct({ status: Schema.Literal("found"), focus: TextQualityFocus }),
	Schema.Struct({ status: Schema.Literal("not_found") }),
	Schema.Struct({ status: Schema.Literal("not_ready") })
]);
export type TextQualityFocusResult = Schema.Schema.Type<typeof TextQualityFocusResult>;
export const decodeTextQualityFocusResult = Schema.decodeUnknownEffect(TextQualityFocusResult);

function excerpt(source: string, maximum: number): string {
	return source.length <= maximum ? source : `${source.slice(0, maximum - 1)}…`;
}

function actualLabel(finding: TextQualityFinding): string {
	return finding.kind === "character_budget"
		? textCountLabel(finding.actual.characterCount, "character")
		: `“${finding.actual.term}” at ${finding.actual.start}–${finding.actual.end}`;
}

function expectationLabel(finding: TextQualityFinding): string {
	if (finding.kind === "character_budget") {
		return `Maximum ${textCountLabel(finding.expectation.maximumCharacters, "character")}`;
	}
	return finding.expectation.kind === "forbidden_term"
		? `Remove “${finding.expectation.term}”`
		: `Prefer “${finding.expectation.preferredTerm}”`;
}

function sourceOf(finding: TextQualityFinding): string {
	return finding.actual.source;
}

/** FNV-1a over UTF-16 code units, 64 bits held as two u32 halves. */
export function textQualityEvidenceHash(evidence: string): readonly [high: number, low: number] {
	let high = 0xcbf29ce4,
		low = 0x84222325;
	for (let index = 0; index < evidence.length; index++) {
		// Multiplying by 2^40 + 0x1b3 modulo 2^64: every partial product stays below 2^53.
		const mixed = (low ^ evidence.charCodeAt(index)) >>> 0;
		const product = mixed * 0x1b3;
		high = (high * 0x1b3 + Math.floor(product / 0x100000000) + ((mixed << 8) >>> 0)) >>> 0;
		low = product >>> 0;
	}
	return [high, low];
}

/** The finding ID of an evidence hash. */
export function textQualityFindingIdOf(high: number, low: number): TextQualityFindingId {
	return makeTextQualityFindingId(
		"quality-finding:" +
			(high === 0 ? low.toString(16) : high.toString(16) + low.toString(16).padStart(8, "0"))
	);
}

/** The evidence hash a finding ID names, or undefined when no finding has this ID's form. */
export function textQualityFindingIdHash(
	id: string
): readonly [high: number, low: number] | undefined {
	const match = /^quality-finding:([0-9a-f]{1,16})$/u.exec(id);
	if (!match) return undefined;
	const hex = match[1]!;
	const high = hex.length > 8 ? Number.parseInt(hex.slice(0, -8), 16) : 0,
		low = Number.parseInt(hex.slice(-8), 16);
	return textQualityFindingIdOf(high, low) === id ? [high, low] : undefined;
}

/** The finding's evidence hash: the two halves of its ID. */
export function textQualityFindingHash(
	finding: TextQualityFinding
): readonly [high: number, low: number] {
	return textQualityEvidenceHash(
		JSON.stringify([
			finding.ruleId,
			finding.role,
			finding.textUnitId,
			finding.kind,
			finding.actual,
			finding.expectation,
			finding.affectedOccurrences.map((occurrence) => occurrence.id).sort()
		])
	);
}

/** Evidence-based IDs survive reordering and unrelated findings disappearing after a scan. */
export function textQualityFindingId(finding: TextQualityFinding): TextQualityFindingId {
	const [high, low] = textQualityFindingHash(finding);
	return textQualityFindingIdOf(high, low);
}

/** Retained, bounded presentation query over a full quality report. */
export interface TextQualityQuery {
	readonly focus: (request: TextQualityFocusRequest) => TextQualityFocus | undefined;
	readonly search: (request: TextQualitySearchRequest) => TextQualitySearchPage;
	readonly export: (filter: TextQualityFilter) => TextQualityReport;
	readonly summary: () => TextQualityQuerySummary;
}

/**
 * A report's findings by position, in report order. A list may keep only compact facts and
 * rebuild findings on demand; `items` returns them for the positions asked, in that order.
 */
export interface TextQualityFindingList {
	readonly length: number;
	readonly kind: (position: number) => TextQualityFindingKind;
	readonly id: (position: number) => TextQualityFindingId;
	/** The first position with this ID. */
	readonly find: (id: TextQualityFindingId) => number | undefined;
	readonly items: (positions: readonly number[]) => readonly TextQualityFinding[];
}

/** Findings hydrated per batch when an export reads them all. */
const EXPORT_BATCH = 2048;

function findingSummary(
	finding: TextQualityFinding,
	id: TextQualityFindingId
): TextQualityFindingSummary {
	return {
		actual: excerpt(actualLabel(finding), 512),
		expectation: excerpt(expectationLabel(finding), 512),
		id,
		kind: finding.kind,
		...(finding.affectedOccurrences[0]
			? { location: finding.affectedOccurrences[0].location }
			: undefined),
		occurrenceCount: finding.affectedOccurrences.length,
		recovery: excerpt(finding.recovery, 2048),
		role: finding.role,
		ruleId: finding.ruleId,
		sourceExcerpt: excerpt(sourceOf(finding), 512),
		textUnitId: finding.textUnitId
	};
}

function findingFocus(
	finding: TextQualityFinding,
	id: TextQualityFindingId,
	request: TextQualityFocusRequest
): TextQualityFocus {
	const cursorIndex = request.occurrenceCursor
		? finding.affectedOccurrences.findIndex(
				(occurrence) => occurrence.id === request.occurrenceCursor
			) + 1
		: 0;
	const start = Math.max(0, cursorIndex);
	const affectedOccurrences = finding.affectedOccurrences.slice(start, start + request.pageSize);
	const final = affectedOccurrences.at(-1)?.id;
	const source = sourceOf(finding);
	const sourceOffset =
		finding.kind === "terminology" && finding.actual.end > 4096
			? Math.max(0, finding.actual.end - 3072)
			: 0;
	const base = {
		affectedOccurrences,
		id,
		recovery: finding.recovery,
		role: finding.role,
		ruleId: finding.ruleId,
		sourceExcerpt: excerpt(source.slice(sourceOffset), 4096),
		sourceOffset,
		sourceTruncated: source.length > 4096,
		textUnitId: finding.textUnitId,
		totalOccurrences: finding.affectedOccurrences.length,
		...(final !== undefined &&
		start + affectedOccurrences.length < finding.affectedOccurrences.length
			? { nextOccurrenceCursor: final }
			: undefined)
	};
	return finding.kind === "character_budget"
		? {
				...base,
				actual: {
					characterCount: finding.actual.characterCount,
					kind: finding.actual.kind
				},
				expectation: finding.expectation,
				kind: finding.kind
			}
		: {
				...base,
				actual: {
					end: finding.actual.end,
					kind: finding.actual.kind,
					start: finding.actual.start,
					term: finding.actual.term
				},
				expectation: finding.expectation,
				kind: finding.kind
			};
}

/**
 * The presentation query over a report whose findings are a list. Counts read only kinds;
 * search, focus and export hydrate just the findings they return.
 */
export function textQualityQueryOf(
	report: Omit<TextQualityReport, "findings">,
	list: TextQualityFindingList
): TextQualityQuery {
	const matchedByFilter = new Map<TextQualityFilter, Uint32Array>();
	const matched = (filter: TextQualityFilter) => {
		let positions = matchedByFilter.get(filter);
		if (!positions) {
			const kept: number[] = [];
			for (let position = 0; position < list.length; position++)
				if (filter === "all" || list.kind(position) === filter) kept.push(position);
			positions = Uint32Array.from(kept);
			matchedByFilter.set(filter, positions);
		}
		return positions;
	};
	let characterBudgetCount = 0;
	for (let position = 0; position < list.length; position++)
		if (list.kind(position) === "character_budget") characterBudgetCount++;
	const summary: TextQualityQuerySummary = {
		characterBudgetCount,
		coverage: report.coverage,
		diagnosticCount: report.diagnosticCount,
		findingCount: list.length,
		roles: report.roles,
		rules: report.rules,
		ruleDocumentVersion: report.ruleDocumentVersion,
		schemaVersion: 1,
		status: report.status,
		terminologyCount: list.length - characterBudgetCount
	};

	return {
		export: (filter) => {
			const positions = Array.from(matched(filter));
			const findings: TextQualityFinding[] = [];
			for (let start = 0; start < positions.length; start += EXPORT_BATCH)
				findings.push(...list.items(positions.slice(start, start + EXPORT_BATCH)));
			return { ...report, findings };
		},
		summary: () => summary,
		search: (request) => {
			const positions = matched(request.filter);
			// Equal findings share an ID; a cursor names the first of them.
			const cursor = request.cursor === undefined ? undefined : list.find(request.cursor);
			let start = 0;
			if (cursor !== undefined) {
				let low = 0,
					high = positions.length;
				while (low < high) {
					const middle = (low + high) >>> 1;
					if (positions[middle]! < cursor) low = middle + 1;
					else high = middle;
				}
				if (positions[low] === cursor) start = low + 1;
			}
			const page = Array.from(positions.subarray(start, start + request.pageSize));
			const findings = list.items(page);
			const final = page.at(-1);
			return {
				findings: findings.map((finding, index) =>
					findingSummary(finding, list.id(page[index]!))
				),
				total: positions.length,
				...(final !== undefined && start + page.length < positions.length
					? { nextCursor: list.id(final) }
					: undefined)
			};
		},
		focus: (request) => {
			const position = list.find(request.id);
			if (position === undefined) return undefined;
			return findingFocus(list.items([position])[0]!, list.id(position), request);
		}
	};
}

/** The presentation query over a report whose findings are all in memory. */
export function textQualityQuery(report: TextQualityReport): TextQualityQuery {
	const { findings, ...rest } = report;
	const ids = findings.map(textQualityFindingId);
	const first = new Map<TextQualityFindingId, number>();
	ids.forEach((id, position) => {
		if (!first.has(id)) first.set(id, position);
	});
	return textQualityQueryOf(rest, {
		length: findings.length,
		kind: (position) => findings[position]!.kind,
		id: (position) => ids[position]!,
		find: (id) => first.get(id),
		items: (positions) => positions.map((position) => findings[position]!)
	});
}
