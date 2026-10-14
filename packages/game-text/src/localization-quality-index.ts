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

/** Lines hydrated per scan page. Bounds the scan's heap; adjacent rows share evidence reads. */
const SCAN_PAGE_LINES = 2048;
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

/** Groups duplicate sources from line columns and shared strings, without hydrating lines. */
function duplicateSources(data: JoinedQueryData, cultures: readonly CultureCode[]) {
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
			// The same conditions as `localizationDuplicateCandidate` on a hydrated line.
			if (occurrenceEnd[row]! > occurrenceStart[row]! && key[index] === "") continue;
			if (text[index]!.trim().length === 0) continue;
			if (states.every((state) => state[row] === outside)) continue;
			groups.add(
				text[index]!,
				LocalizationIdentity.make({
					namespace: TextNamespace.make(namespace[index]!),
					key: TextKey.make(key[index]!)
				})
			);
		}
	}
	return groups.finish();
}

/**
 * Localization quality over a joined index. Lines are checked in bounded pages and dropped;
 * findings are kept as columns. Pages, focus and proposals re-check only the rows they show, with
 * the same line checks `checkLocalizationTarget` runs.
 */
export function indexedLocalizationQuality(
	joined: JoinedTargetReader,
	corpus: Pick<TextCorpus, "status" | "coverage">,
	evidence: LocalizationTargetEvidence,
	options: LocalizationCheckOptions = {},
	ruleDocument?: GameTextRuleDocument
): LocalizationQuality {
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
	const context: LocalizationLineCheckContext = {
		target: target.name,
		options,
		enabled,
		duplicates: duplicateSources(data, target.cultures)
	};
	const units = unitIndex(data);
	/** One line's findings in report order, and its check diagnostics. */
	const check = (line: LocalizationLine) => {
		let lineUnits: readonly TextUnit[] | undefined;
		const unitsOf = () => (lineUnits ??= localizationLineUnits(line, units.forLine(line)));
		const builtIns: LocalizationQualityFinding[] = [],
			diagnostics: LocalizationCheckDiagnostic[] = [];
		checkLocalizationLine(line, unitsOf, context, {
			findings: builtIns,
			checkDiagnostics: diagnostics,
			changes: []
		});
		const policyFindings: LocalizationPolicyFinding[] = [];
		for (const rule of policy?.rules ?? [])
			localizationLinePolicyFindings(
				line,
				unitsOf,
				rule,
				target.name,
				options,
				policyFindings
			);
		const findings: Finding[] = [
			...builtIns.sort(compareLocalizationFindings),
			...policyFindings
		];
		const visible = keep ? findings.filter((finding) => keep(line, finding)) : findings;
		return {
			findings: visible.sort(compareReportedLocalizationFindings),
			diagnostics
		};
	};

	// Report order is line ID order; the scan reads rows in storage order and reorders after.
	const count = data.joined.meta.count;
	const order = (() => {
		const ids = Array.from({ length: count }, (_, row) => data.lineId(row));
		const collator = new Intl.Collator();
		return Uint32Array.from(
			Array.from({ length: count }, (_, row) => row).sort((a, b) =>
				collator.compare(ids[a]!, ids[b]!)
			)
		);
	})();
	const rank = new Uint32Array(count);
	for (let index = 0; index < count; index++) rank[order[index]!] = index;

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

	const storedFacts = u32Builder(),
		storedFirst = u32Builder(),
		storedSecond = u32Builder();
	const rowStart = new Uint32Array(count + 1);
	for (let start = 0; start < count; start += SCAN_PAGE_LINES) {
		const rows = Array.from(
			{ length: Math.min(count, start + SCAN_PAGE_LINES) - start },
			(_, index) => start + index
		);
		const lines = data.lines(rows);
		for (let index = 0; index < rows.length; index++) {
			const row = rows[index]!;
			rowStart[row] = storedFacts.length;
			const { findings, diagnostics } = check(lines[index]!);
			for (const finding of findings) {
				const [first, second] = localizationFindingHash(finding);
				storedFacts.push(pack(finding));
				storedFirst.push(first);
				storedSecond.push(second);
			}
			for (let position = 0; position < diagnostics.length; position++) {
				const diagnostic = diagnostics[position]!,
					seen = rank[row]! * 2 ** 20 + position;
				recordLimit("", diagnostic.code, seen);
				recordLimit(diagnostic.culture, diagnostic.code, seen);
			}
		}
	}
	rowStart[count] = storedFacts.length;

	const total = storedFacts.length;
	const facts = new Uint32Array(total),
		first = new Uint32Array(total),
		second = new Uint32Array(total),
		rowOf = new Uint32Array(total),
		rowPosition = new Uint32Array(count);
	let position = 0;
	for (const row of order) {
		rowPosition[row] = position;
		for (let stored = rowStart[row]!; stored < rowStart[row + 1]!; stored++, position++) {
			facts[position] = storedFacts.at(stored);
			first[position] = storedFirst.at(stored);
			second[position] = storedSecond.at(stored);
			rowOf[position] = row;
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

	/** Re-checks the rows behind positions; each finding must hash as it did in the scan. */
	const hydrate = (positions: readonly number[]) => {
		const rows = [...new Set(positions.map((position) => rowOf[position]!))];
		const lines = data.lines(rows);
		const checked = new Map(
			rows.map((row, index) => [row, { line: lines[index]!, ...check(lines[index]!) }])
		);
		return positions.map((position) => {
			const row = rowOf[position]!,
				{ line, findings } = checked.get(row)!;
			const finding = findings[position - rowPosition[row]!];
			const hash = finding && localizationFindingHash(finding);
			snapshotCheck(
				finding !== undefined &&
					hash !== undefined &&
					hash[0] === first[position] &&
					hash[1] === second[position],
				"quality.findings",
				"A line no longer yields the finding its index recorded"
			);
			return workspaceQualityItem(finding, line);
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
			for (let row = 0; row < count; row++)
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
	};
}
