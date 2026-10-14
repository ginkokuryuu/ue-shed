import { Effect } from "effect";
import {
	LocalizationIdentity,
	TextKey,
	TextNamespace,
	type CultureCode,
	type LocalizationTargetEvidence
} from "@ue-shed/localization";
import {
	checkLocalizationLine,
	compareLocalizationFindings,
	compareReportedLocalizationFindings,
	enabledLocalizationChecks,
	localizationDuplicateSources,
	type LocalizationLineCheckContext
} from "./localization-checks.js";
import type {
	LocalizationCheckDiagnostic,
	LocalizationCheckOptions,
	LocalizationPolicyFinding,
	LocalizationQualityFinding
} from "./localization-quality-schema.js";
import { localizationLinePolicyFindings, localizationPolicyRules } from "./localization-policy.js";
import { acceptedFindingFilter } from "./localization-review.js";
import { localizationStates, type LocalizationLine } from "./localization-schema.js";
import {
	WorkspaceQualityFilter,
	eligibleLocalizationChange,
	localizationFindingHash,
	workspaceQualityFilterOf,
	workspaceQualityItem,
	type LocalizationFindingList,
	type LocalizationQuality
} from "./localization-workspace.js";
import { localizationLineUnits } from "./gathered-text.js";
import { JoinedQueryData } from "./joined-query-data.js";
import { u32 } from "./joined-target-input.js";
import { runJoinedQuery } from "./joined-query-node.js";
import type { JoinedTargetReader } from "./joined-target-reader.js";
import type { GameTextRuleDocument } from "./quality-rules-v2.js";
import { TextQualityRuleId } from "./quality-schema.js";
import type { TextCorpus, TextUnit, TextUnitId } from "./schema.js";
import { snapshotCheck } from "./snapshot-format.js";
import { encodeWtf8 } from "./wtf8.js";

/**
 * Lines hydrated and checked per scan page; the scan yields after each. Measured on 583,507
 * lines and 10 cultures, the longest event-loop stall was 0.5–0.7 s at 256 lines, 1.0 s at 512
 * and 2.6 s at 2048, for a scan 10% longer than at 2048 (114 s against 104 s). Yielding inside
 * 2048-line pages still stalled 2.0 s: hydrating the page is one synchronous block.
 */
const SCAN_PAGE_LINES = 256;
/** Positions hydrated per batch when a workspace reads many findings, as an export does. */
const ITEM_BATCH = 2048;

type Finding = LocalizationQualityFinding | LocalizationPolicyFinding;

/** Growable u32 column; scans append, then trim. */
function u32Builder() {
	let values = new Uint32Array(4096),
		length = 0;
	return {
		get length() {
			return length;
		},
		at: (index: number) => values[index]!,
		push(value: number) {
			if (length === values.length) {
				const next = new Uint32Array(values.length * 2);
				next.set(values);
				values = next;
			}
			values[length++] = value;
		}
	};
}

function fnv32(bytes: Uint8Array, start: number, end: number) {
	let hash = 0x811c9dc5;
	for (let index = start; index < end; index++)
		hash = Math.imul(hash ^ bytes[index]!, 0x01000193);
	return hash >>> 0;
}

/** Unit rows by ID through a hash of the ID column; never builds the unit list. */
function unitIndex(data: JoinedQueryData) {
	const idRows = data.column("query.raw.raw"),
		starts = data.column("query.raw.id_starts"),
		words = data.column("query.raw.id_utf8");
	const bytes = new Uint8Array(words.buffer, words.byteOffset, words.byteLength);
	const hashes = new Uint32Array(idRows.length);
	for (let row = 0; row < idRows.length; row++)
		hashes[row] = fnv32(bytes, starts[idRows[row]!]!, starts[idRows[row]! + 1]!);
	const order = Uint32Array.from(hashes.keys()).sort((a, b) => hashes[a]! - hashes[b]!);
	const find = (id: string): number | undefined => {
		const wanted = encodeWtf8(id),
			hash = fnv32(wanted, 0, wanted.length);
		let low = 0,
			high = order.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (hashes[order[middle]!]! < hash) low = middle + 1;
			else high = middle;
		}
		for (; low < order.length && hashes[order[low]!] === hash; low++) {
			const row = order[low]!,
				start = starts[idRows[row]!]!;
			if (starts[idRows[row]! + 1]! - start !== wanted.length) continue;
			let index = 0;
			while (index < wanted.length && bytes[start + index] === wanted[index]) index++;
			if (index === wanted.length) return row;
		}
		return undefined;
	};
	return {
		find,
		/** The units a line names, keyed the way `localizationLineUnits` looks them up. */
		forLine(line: LocalizationLine): ReadonlyMap<TextUnitId, TextUnit> {
			const units = new Map<TextUnitId, TextUnit>();
			if (line.origin.kind !== "corpus") return units;
			for (const id of line.origin.unitIds) {
				const row = find(id);
				if (row !== undefined) units.set(id, data.unit("raw", row));
			}
			return units;
		},
		idRow: (row: number) => idRows[row]!
	};
}

/** Positions of rows outside the join. */
const NOT_JOINED = 0xffffffff;

/**
 * Groups duplicate sources from line columns and shared strings, without hydrating lines. Only
 * the join's rows count, and identities that compare equal keep the join's order.
 */
const duplicateSources = Effect.fn("GameText.localizationQuality.duplicates")(function* (
	data: JoinedQueryData,
	cultures: readonly CultureCode[],
	joinPosition: Uint32Array
) {
	const column = (name: string) => runJoinedQuery(u32(data.joined.layer, name));
	const namespaces = column("line.namespace"),
		keys = column("line.key"),
		sources = column("line.source"),
		occurrenceStart = column("line.occ_start"),
		occurrenceEnd = column("line.occ_end");
	const states = cultures.map((_, index) => column(`c${index}.state`));
	const outside = localizationStates.indexOf("outside_target");
	const groups = localizationDuplicateSources();
	const count = data.joined.meta.count;
	for (let start = 0; start < count; start += SCAN_PAGE_LINES) {
		const end = Math.min(count, start + SCAN_PAGE_LINES);
		const text = data.strings(Array.from(sources.subarray(start, end))),
			key = data.strings(Array.from(keys.subarray(start, end))),
			namespace = data.strings(Array.from(namespaces.subarray(start, end)));
		for (let row = start; row < end; row++) {
			const index = row - start;
			if (joinPosition[row] === NOT_JOINED) continue;
			// The same conditions as `localizationDuplicateCandidate` on a hydrated line.
			if (occurrenceEnd[row]! > occurrenceStart[row]! && key[index] === "") continue;
			if (text[index]!.trim().length === 0) continue;
			if (states.every((state) => state[row] === outside)) continue;
			groups.add(
				text[index]!,
				LocalizationIdentity.make({
					namespace: TextNamespace.make(namespace[index]!),
					key: TextKey.make(key[index]!)
				}),
				joinPosition[row]!
			);
		}
		yield* Effect.yieldNow;
	}
	return groups.finish();
});

/**
 * Localization quality over a joined index. Lines are checked in bounded pages and dropped;
 * findings are kept as columns. Pages, focus and proposals re-check only the rows they show, with
 * the same line checks `checkLocalizationTarget` runs. The scan yields between pages, so a host
 * keeps serving other requests and can interrupt it.
 *
 * `joinRows` are the join's lines as rows of `joined`, in the join's order: the rows the query's
 * `localizationLines` returns for the target. Only they are checked, as only they are in the join.
 */
export const indexedLocalizationQuality = Effect.fn("GameText.localizationQuality")(function* (
	joined: JoinedTargetReader,
	corpus: Pick<TextCorpus, "status" | "coverage">,
	evidence: LocalizationTargetEvidence,
	joinRows: Uint32Array,
	options: LocalizationCheckOptions = {},
	ruleDocument?: GameTextRuleDocument
) {
	const data = new JoinedQueryData(joined);
	const target = data.joined.meta.input.target;
	const join = {
		target: target.name,
		nativeCulture: target.nativeCulture,
		cultures: target.cultures
	};
	const enabled = enabledLocalizationChecks(join, evidence, options, ruleDocument);
	const policy =
		ruleDocument?.schemaVersion === 2
			? localizationPolicyRules(target.cultures, ruleDocument)
			: undefined;
	const keep = acceptedFindingFilter(options.review);
	const count = data.joined.meta.count,
		lineCount = joinRows.length;
	const joinPosition = new Uint32Array(count).fill(NOT_JOINED);
	for (let position = 0; position < lineCount; position++)
		joinPosition[joinRows[position]!] = position;
	const context: LocalizationLineCheckContext = {
		target: target.name,
		options,
		enabled,
		duplicates: yield* duplicateSources(data, target.cultures, joinPosition)
	};
	const units = unitIndex(data);
	yield* Effect.yieldNow;

	// Report order is line ID order, ties in join order. Decoding every line ID takes about 0.7 s
	// at 583,507 lines, so it yields per page; the unit index above and the sort below take about
	// 0.25 s and 0.1 s.
	const ids: string[] = [];
	for (let start = 0; start < lineCount; start += SCAN_PAGE_LINES) {
		const end = Math.min(lineCount, start + SCAN_PAGE_LINES);
		for (let position = start; position < end; position++)
			ids[position] = data.lineId(joinRows[position]!);
		yield* Effect.yieldNow;
	}
	const collator = new Intl.Collator();
	// Stable, so lines whose IDs compare equal keep the join's order.
	const sorted = Array.from({ length: lineCount }, (_, position) => position).sort((a, b) =>
		collator.compare(ids[a]!, ids[b]!)
	);
	yield* Effect.yieldNow;
	/** Rows by rank in report order. */
	const order = Uint32Array.from(sorted, (position) => joinRows[position]!);
	/**
	 * Lines whose ID compares equal to the previous line's, as canonically equivalent keys do.
	 * The report interleaves such lines by culture and check, so each run of them is one block,
	 * checked and stored together and known by its first rank. Nearly every block is one line.
	 */
	const tied = new Uint8Array(lineCount);
	for (let start = 1; start < lineCount; start += SCAN_PAGE_LINES * 16) {
		const end = Math.min(lineCount, start + SCAN_PAGE_LINES * 16);
		for (let rank = start; rank < end; rank++)
			if (collator.compare(ids[sorted[rank - 1]!]!, ids[sorted[rank]!]!) === 0)
				tied[rank] = 1;
		yield* Effect.yieldNow;
	}
	// A suspended generator keeps its locals; release the IDs before the long scan.
	ids.length = 0;
	sorted.length = 0;
	const rankOf = new Uint32Array(count);
	for (let rank = 0; rank < lineCount; rank++) rankOf[order[rank]!] = rank;
	const blockEnd = (first: number) => {
		let end = first + 1;
		while (end < lineCount && tied[end]) end++;
		return end;
	};
	const lineOf = (lines: readonly LocalizationLine[], finding: Finding) =>
		lines.length === 1 ? lines[0]! : lines.find((line) => line.id === finding.lineId)!;

	/**
	 * One block's findings in report order, and each line's check diagnostics. As the report does,
	 * built-ins sort first and policy findings follow rule by rule over the lines; accepted findings
	 * then leave and the rest sort as reported. Both sorts are stable.
	 */
	const check = (lines: readonly LocalizationLine[]) => {
		const unitsOf = lines.map((line) => {
			let lineUnits: readonly TextUnit[] | undefined;
			return () => (lineUnits ??= localizationLineUnits(line, units.forLine(line)));
		});
		const builtIns: LocalizationQualityFinding[] = [],
			diagnostics: LocalizationCheckDiagnostic[][] = [];
		for (let index = 0; index < lines.length; index++) {
			const lineDiagnostics: LocalizationCheckDiagnostic[] = [];
			checkLocalizationLine(lines[index]!, unitsOf[index]!, context, {
				findings: builtIns,
				checkDiagnostics: lineDiagnostics,
				changes: []
			});
			diagnostics.push(lineDiagnostics);
		}
		const policyFindings: LocalizationPolicyFinding[] = [];
		for (const rule of policy?.rules ?? [])
			for (let index = 0; index < lines.length; index++)
				localizationLinePolicyFindings(
					lines[index]!,
					unitsOf[index]!,
					rule,
					target.name,
					options,
					policyFindings
				);
		const findings: Finding[] = [
			...builtIns.sort(compareLocalizationFindings),
			...policyFindings
		];
		const visible = keep
			? findings.filter((finding) => keep(lineOf(lines, finding), finding))
			: findings;
		return {
			findings: visible.sort(compareReportedLocalizationFindings),
			diagnostics
		};
	};

	const cultureIndex = new Map(target.cultures.map((culture, index) => [culture, index]));
	const filterIndex = new Map(
		WorkspaceQualityFilter.literals.map((filter, index) => [filter, index])
	);
	const ruleIds: TextQualityRuleId[] = [];
	const ruleIndex = new Map<string, number>();
	const ruleOf = (id: TextQualityRuleId) => {
		let index = ruleIndex.get(id);
		if (index === undefined) {
			index = ruleIds.push(id) - 1;
			ruleIndex.set(id, index);
		}
		return index;
	};
	// Facts per finding: culture (bits 0-11), filter (12-17), fix eligible (18), rule (19-31).
	const pack = (finding: Finding) => {
		const culture = cultureIndex.get(finding.culture)!,
			rule = ruleOf(finding.ruleId);
		snapshotCheck(
			culture < 4096 && rule < 8192,
			"quality.findings",
			"Too many cultures or rules"
		);
		return (
			(culture |
				(filterIndex.get(workspaceQualityFilterOf(finding))! << 12) |
				(eligibleLocalizationChange(finding) ? 1 << 18 : 0) |
				(rule << 19)) >>>
			0
		);
	};
	type Code = LocalizationCheckDiagnostic["code"];
	const limitCounts = new Map<string, Map<Code, { count: number; first: number }>>();
	const recordLimit = (scope: string, code: Code, seen: number) => {
		let codes = limitCounts.get(scope);
		if (!codes) limitCounts.set(scope, (codes = new Map()));
		const entry = codes.get(code);
		if (!entry) codes.set(code, { count: 1, first: seen });
		else {
			entry.count++;
			entry.first = Math.min(entry.first, seen);
		}
	};

	/** The blocks starting at these ranks, hydrated in one page: their lines in rank order. */
	const blockLines = (firsts: readonly number[]) => {
		const rows: number[] = [];
		for (const first of firsts)
			for (let rank = first, end = blockEnd(first); rank < end; rank++)
				rows.push(order[rank]!);
		const lines = data.lines(rows);
		let next = 0;
		return firsts.map((first) => {
			const size = blockEnd(first) - first;
			return size === 1 ? [lines[next++]!] : lines.slice(next, (next += size));
		});
	};
	const storedFacts = u32Builder(),
		storedFirst = u32Builder(),
		storedSecond = u32Builder();
	const blockStart = new Uint32Array(lineCount),
		blockSize = new Uint32Array(lineCount);
	const checkBlocks = (firsts: readonly number[]) => {
		const blocks = blockLines(firsts);
		for (let block = 0; block < firsts.length; block++) {
			const lines = blocks[block]!,
				rank = firsts[block]!;
			const { findings, diagnostics } = check(lines);
			blockStart[rank] = storedFacts.length;
			blockSize[rank] = findings.length;
			for (const finding of findings) {
				const [first, second] = localizationFindingHash(finding);
				storedFacts.push(pack(finding));
				storedFirst.push(first);
				storedSecond.push(second);
			}
			for (let index = 0; index < lines.length; index++)
				for (let position = 0; position < diagnostics[index]!.length; position++) {
					const diagnostic = diagnostics[index]![position]!,
						seen = (rank + index) * 2 ** 20 + position;
					recordLimit("", diagnostic.code, seen);
					recordLimit(diagnostic.culture, diagnostic.code, seen);
				}
		}
	};
	// One-line blocks in storage order, so each page hydrates adjacent rows.
	let page: number[] = [];
	for (let row = 0; row < count; row++) {
		if (joinPosition[row] === NOT_JOINED) continue;
		const rank = rankOf[row]!;
		if (tied[rank] || (rank + 1 < lineCount && tied[rank + 1])) continue;
		page.push(rank);
		if (page.length < SCAN_PAGE_LINES) continue;
		checkBlocks(page);
		page = [];
		yield* Effect.yieldNow;
	}
	// Then the rare blocks of several lines.
	for (let rank = 0; rank + 1 < lineCount; rank++) {
		if (tied[rank] || !tied[rank + 1]) continue;
		page.push(rank);
		if (page.length < SCAN_PAGE_LINES) continue;
		checkBlocks(page);
		page = [];
		yield* Effect.yieldNow;
	}
	if (page.length) checkBlocks(page);
	page = [];

	const total = storedFacts.length;
	const facts = new Uint32Array(total),
		first = new Uint32Array(total),
		second = new Uint32Array(total),
		blockOf = new Uint32Array(total),
		blockPosition = new Uint32Array(lineCount);
	let position = 0;
	for (let rank = 0; rank < lineCount; rank++) {
		if (tied[rank]) continue;
		blockPosition[rank] = position;
		const end = blockStart[rank]! + blockSize[rank]!;
		for (let stored = blockStart[rank]!; stored < end; stored++, position++) {
			facts[position] = storedFacts.at(stored);
			first[position] = storedFirst.at(stored);
			second[position] = storedSecond.at(stored);
			blockOf[position] = rank;
		}
	}
	const limits = new Map(
		[...limitCounts].map(([scope, codes]) => [
			scope,
			[...codes]
				.sort(([, a], [, b]) => a.first - b.first)
				.map(([code, { count }]) => ({ code, count }))
		])
	);

	/** Re-checks the blocks behind positions; each finding must hash as it did in the scan. */
	const hydrate = (positions: readonly number[]) => {
		const firsts = [...new Set(positions.map((position) => blockOf[position]!))];
		const blocks = blockLines(firsts);
		const checked = new Map(
			firsts.map((rank, block) => [
				rank,
				{ lines: blocks[block]!, findings: check(blocks[block]!).findings }
			])
		);
		return positions.map((position) => {
			const block = blockOf[position]!,
				{ lines, findings } = checked.get(block)!;
			const finding = findings[position - blockPosition[block]!];
			const hash = finding && localizationFindingHash(finding);
			snapshotCheck(
				finding !== undefined &&
					hash !== undefined &&
					hash[0] === first[position] &&
					hash[1] === second[position],
				"quality.findings",
				"A line no longer yields the finding its index recorded"
			);
			return workspaceQualityItem(finding, lineOf(lines, finding));
		});
	};
	let lineOfRaw: Uint32Array | undefined;
	const lineOfUnit = (id: TextUnitId) => {
		const raw = units.find(id);
		if (raw === undefined) return undefined;
		if (!lineOfRaw) {
			// Later lines win, as a map built over the join's lines would.
			const starts = data.column("query.line.starts"),
				sliceRaw = data.column("query.slice.raw");
			let size = 0;
			for (const raw of sliceRaw) size = Math.max(size, raw + 1);
			lineOfRaw = new Uint32Array(size);
			for (const row of joinRows)
				for (let slice = starts[row]!; slice < starts[row + 1]!; slice++)
					lineOfRaw[sliceRaw[slice]!] = row + 1;
		}
		const row = lineOfRaw[units.idRow(raw)];
		return row ? data.line(row - 1) : undefined;
	};
	const findings: LocalizationFindingList = {
		length: total,
		culture: (position) => target.cultures[facts[position]! & 0xfff]!,
		filter: (position) => WorkspaceQualityFilter.literals[(facts[position]! >>> 12) & 0x3f]!,
		ruleId: (position) => ruleIds[facts[position]! >>> 19]!,
		eligible: (position) => ((facts[position]! >>> 18) & 1) === 1,
		find(id, culture) {
			const match = /^localization-finding:([0-9a-f]{8})([0-9a-f]{8})$/u.exec(id);
			if (!match) return undefined;
			const wantedFirst = Number.parseInt(match[1]!, 16),
				wantedSecond = Number.parseInt(match[2]!, 16);
			for (let position = 0; position < total; position++)
				if (
					first[position] === wantedFirst &&
					second[position] === wantedSecond &&
					(!culture || findings.culture(position) === culture)
				)
					return position;
			return undefined;
		},
		items(positions) {
			const items = [];
			for (let start = 0; start < positions.length; start += ITEM_BATCH)
				items.push(...hydrate(positions.slice(start, start + ITEM_BATCH)));
			return items;
		},
		limits: (culture) => limits.get(culture ?? "") ?? []
	};
	return {
		findings,
		metadata: {
			join,
			rules: [
				...(ruleDocument?.schemaVersion === 2
					? (ruleDocument.localizationRules ?? []).map((rule) => rule.id)
					: []),
				...enabled.map((id) => TextQualityRuleId.make(`localization.${id}`))
			],
			unsupportedRuleCultures: policy?.diagnostics.length ?? 0,
			status: corpus.status,
			coverage: corpus.coverage,
			lineOfUnit
		}
	} satisfies LocalizationQuality;
});
