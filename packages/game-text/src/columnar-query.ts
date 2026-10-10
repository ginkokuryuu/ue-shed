import { Schema } from "effect";
import type { TextCorpusQuery } from "./query.js";
import { JoinedQueryData, querySignals } from "./joined-query-data.js";
import type { JoinedTargetReader } from "./joined-target-reader.js";
import {
	TextProblem,
	type TextCorpusSearchRequest,
	type TextCorpusSearchCounts,
	type TextCorpusQuerySummary,
	type TextFilterField,
	TextUnitId
} from "./schema.js";
import {
	textProblems,
	textFindings,
	matchesTextFilter,
	textProblemCounts,
	type TextFacts
} from "./text-problems.js";
import {
	TEXT_ORIGIN_KINDS,
	emptyTextOriginCounts,
	normalizeTextPath,
	textFileKey,
	textFileScope,
	matchesTextFiles,
	matchesTextPathPrefix,
	matchesTextKinds,
	textFileScopeSummary
} from "./text-origin.js";
import {
	textGroups,
	textGroupOf,
	textAssetFacet,
	textFolderFacet,
	textOriginFacet,
	textCultureFacet
} from "./text-groups.js";
import { localizationLinePreview, validateLocalizationSelection } from "./localization-query.js";
import {
	LocalizationReviewLens,
	LocalizationUnknownReason,
	localizationStates,
	GameTextLocalizationError,
	type LocalizationCultureMark,
	type LocalizationSelection,
	LocalizationQueryPage,
	LocalizationLineId
} from "./localization-schema.js";

type Request = Omit<TextCorpusSearchRequest, "cursor" | "pageSize">;
const emptyCounts = () =>
	({
		all: 0,
		shared: 0,
		duplicate_source: 0,
		long: 0,
		unresolved: 0,
		conflicting: 0,
		editable: 0,
		readOnly: 0,
		withoutNotes: 0,
		origins: emptyTextOriginCounts()
	}) satisfies TextCorpusSearchCounts;
const terms = (value: string) => value.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
const signals = (mask: number) => querySignals.filter((_, bit) => mask & (1 << bit));
const countedSignals = ["shared", "duplicate_source", "long", "unresolved", "conflicting"] as const;
const origins = (mask: number) => TEXT_ORIGIN_KINDS.filter((_, bit) => mask & (1 << bit));

/** The published numeric columns supply predicates; only selected rows hydrate public objects. */
export function columnarTextCorpusQuery(
	joined: JoinedTargetReader,
	scannedAt?: string
): TextCorpusQuery {
	const data = new JoinedQueryData(joined),
		target = joined.meta.input.target;
	const c = (name: string) => data.column(name);
	const rawOrder = c("query.raw.order"),
		lineOrder = c("query.line.order");
	const lineStarts = c("query.line.starts");
	const cultureColumns = target.cultures.map((_, index) =>
		Object.fromEntries(
			["state", "facts", "reasons", "review", "review_record"].map((field) => [
				field,
				c(`c${index}.${field}`)
			])
		)
	);
	const joinHeader = {
		schemaVersion: 1 as const,
		target: target.name,
		nativeCulture: target.nativeCulture,
		cultures: target.cultures,
		lines: []
	};
	const raw = Object.fromEntries(
		[
			"visible",
			"signals",
			"origins",
			"editing",
			"notes",
			"member_start",
			"member_end",
			"source_start",
			"source_end",
			"sources",
			"file_start",
			"file_end",
			"files"
		].map((field) => [field, c(`query.raw.${field}`)])
	);
	const slice = Object.fromEntries(
		[
			"visible",
			"signals",
			"origins",
			"editing",
			"notes",
			"member_start",
			"member_end",
			"source_start",
			"source_end",
			"sources",
			"file_start",
			"file_end",
			"files"
		].map((field) => [field, c(`query.slice.${field}`)])
	);
	const scoped = (selection: LocalizationSelection | undefined) =>
		target.cultures
			.map((culture, index) => ({ culture, index }))
			.filter(({ culture }) =>
				selection?.culture !== undefined
					? culture === selection.culture
					: selection?.cultures === undefined || selection.cultures.includes(culture)
			);
	const marks = (row: number): readonly LocalizationCultureMark[] =>
		target.cultures.map((culture, ci) => {
			const prefix = `c${ci}.`,
				review = c(prefix + "review")[row]!,
				record = joined.meta.input.review?.records[c(prefix + "review_record")[row]! - 1];
			return {
				culture,
				state: localizationStates[c(prefix + "state")[row]!]!,
				facts: localizationStates.filter(
					(_, bit) => c(prefix + "facts")[row]! & (1 << bit)
				),
				unknownReasons: LocalizationUnknownReason.literals.filter(
					(_, bit) => c(prefix + "reasons")[row]! & (1 << bit)
				),
				reducedSourceChecking: joined.meta.reducedSourceChecking[ci]!,
				...(review
					? {
							review:
								review < 2
									? { status: "not_reviewed" as const }
									: {
											status:
												review === 2
													? ("current" as const)
													: ("changed" as const),
											flags: record!.flags,
											by: record!.by,
											at: record!.at
										}
						}
					: undefined)
			};
		});
	const entryFacts = (kind: "raw" | "slice", row: number): TextFacts => {
		const fields = kind === "raw" ? raw : slice;
		const mask = fields.signals![row]!;
		const members = data.members(kind, row);
		return {
			problems: textProblems({ signals: signals(mask), keyChanged: false }),
			findings: textFindings(signals(mask)),
			translation: [],
			origins: origins(fields.origins![row]!),
			editing: [
				...(fields.editing![row]! & 1 ? ["editable" as const] : []),
				...(fields.editing![row]! & 2 ? ["read_only" as const] : [])
			],
			notes: fields.notes![row] ? "present" : "missing",
			get files() {
				return data.strings(
					Array.from(
						fields.files!.subarray(fields.file_start![row]!, fields.file_end![row]!)
					)
				);
			},
			get namespace() {
				const identity = data.occurrence(members[0]!).identity;
				return identity.status === "resolved"
					? identity.namespace
					: identity.status === "string_table"
						? identity.tableId
						: undefined;
			},
			get paths() {
				return Array.from(members).flatMap((member) => {
					const occurrence = data.occurrence(member);
					return [
						normalizeTextPath(occurrence.packageFile),
						normalizeTextPath(occurrence.location.objectPath)
					];
				});
			}
		};
	};
	const lineFlags = (row: number) => {
		let mask = 0;
		for (let sr = lineStarts[row]!; sr < lineStarts[row + 1]!; sr++)
			if (slice.visible![sr]) mask |= slice.signals![sr]!;
		return mask;
	};
	const cultureScope = (selection: LocalizationSelection | undefined) =>
		target.cultures.flatMap((culture, index) =>
			selection?.culture !== undefined
				? culture === selection.culture
					? [index]
					: []
				: selection?.cultures === undefined || selection.cultures.includes(culture)
					? [index]
					: []
		);
	const reviewMask = (row: number, ci: number) => {
		const columns = cultureColumns[ci]!,
			code = columns.review![row]!,
			state = columns.state![row]!;
		const current =
			code === 2
				? joined.meta.input.review!.records[columns.review_record![row]! - 1]!.flags
				: [];
		const reviewable = state === 0 || state === 2 || state === 3;
		return (
			(current.includes("reviewed") ? 1 : reviewable ? 2 : 0) |
			(reviewable && !current.includes("proofread") ? 4 : 0) |
			(code === 3 ? 8 : 0) |
			(current.includes("machine_translated") ? 16 : 0)
		);
	};
	const problemMask = (row: number, scope: readonly number[]) => {
		const flags = lineFlags(row),
			key = c("line.key_change")[row]!;
		let mask = (key > 0 && !(key & 1) ? 1 : 0) | (flags & 16 ? 2 : 0) | (flags & 15 ? 32 : 0);
		for (const ci of scope) {
			const columns = cultureColumns[ci]!,
				state = columns.state![row]!;
			if (columns.reasons![row]! & (1 << 11)) mask |= 2;
			if (state === 4) mask |= 4;
			if (state === 5) mask |= 8;
			if (state === 1 || state === 2 || columns.facts![row]! & 8) mask |= 16;
		}
		return mask || 64;
	};
	const lineFacts = (row: number, selection: LocalizationSelection): TextFacts => {
		const flags = lineFlags(row),
			scope = cultureScope(selection),
			problems = problemMask(row, scope);
		let translation = 0;
		for (const ci of scope) {
			const columns = cultureColumns[ci]!;
			if (columns.state![row] === 1) translation |= 1;
			if (columns.state![row] === 2) translation |= 2;
			if (columns.state![row] === 3 || columns.facts![row]! & 8) translation |= 4;
		}
		return {
			problems: TextProblem.literals.filter((_, bit) => problems & (1 << bit)),
			findings: textFindings(signals(flags)),
			translation: [
				...(translation & 1 ? ["missing" as const] : []),
				...(translation & 2 ? ["to_update" as const] : []),
				...(translation & 4 ? ["not_synced" as const] : [])
			],
			origins: origins(c("line.origins")[row]!),
			editing: [
				...(c("line.editing")[row]! & 1 ? ["editable" as const] : []),
				...(c("line.editing")[row]! & 2 ? ["read_only" as const] : [])
			],
			notes: c("line.notes")[row] ? "present" : "missing",
			get namespace() {
				return lineStarts[row] !== lineStarts[row + 1] && c("line.key")[row] === 0
					? undefined
					: data.strings([c("line.namespace")[row]!])[0];
			},
			get files() {
				if (lineStarts[row] === lineStarts[row + 1])
					return data.strings(
						Array.from(
							c("facet.files").subarray(
								c("line.file_start")[row]!,
								c("line.file_end")[row]!
							)
						)
					);
				const files: string[] = [];
				for (let sr = lineStarts[row]!; sr < lineStarts[row + 1]!; sr++)
					if (slice.visible![sr]) files.push(...entryFacts("slice", sr).files);
				return [...new Set(files)];
			},
			get paths() {
				const line = data.line(row);
				return [
					...Array.from(
						{ length: lineStarts[row + 1]! - lineStarts[row]! },
						(_, i) => lineStarts[row]! + i
					)
						.filter((sr) => slice.visible![sr])
						.flatMap((sr) => entryFacts("slice", sr).paths),
					...line.manifest.map((entry) => normalizeTextPath(entry.path))
				];
			}
		};
	};
	const sourceMatches = (fields: typeof raw, row: number, wanted: readonly string[]) =>
		wanted.every((term) =>
			data
				.strings(
					Array.from(
						fields.sources!.subarray(
							fields.source_start![row]!,
							fields.source_end![row]!
						)
					)
				)
				.join(" ")
				.toLocaleLowerCase()
				.includes(term)
		);
	const eligible = (
		kind: "raw" | "slice",
		row: number,
		request: Request,
		search: boolean,
		wanted: readonly string[] = []
	) => {
		const fields = kind === "raw" ? raw : slice;
		if (!fields.visible![row]) return false;
		if (search && wanted.length && !sourceMatches(fields, row, wanted)) return false;
		const flags = fields.signals![row]!,
			editing = fields.editing![row]!;
		if (
			(request.capability === "source_editable" && !(editing & 1)) ||
			(request.capability === "read_only" && !(editing & 2))
		)
			return false;
		if (request.withoutNotes && fields.notes![row]) return false;
		if (
			request.lens !== undefined &&
			request.lens !== "all" &&
			!(flags & (1 << querySignals.indexOf(request.lens)))
		)
			return false;
		if (
			request.where?.kinds !== undefined &&
			!matchesTextKinds(origins(fields.origins![row]!), request.where.kinds)
		)
			return false;
		if (
			request.filter === undefined &&
			request.where?.pathPrefix === undefined &&
			request.where?.files === undefined
		)
			return true;
		const facts = entryFacts(kind, row);
		if (!matchesTextFilter(facts, request.filter)) return false;
		if (
			request.where?.pathPrefix !== undefined &&
			!matchesTextPathPrefix(facts.paths, request.where.pathPrefix)
		)
			return false;
		if (
			request.where?.files !== undefined &&
			!matchesTextFiles(facts.files.map(textFileKey), textFileScope(request.where.files))
		)
			return false;
		return true;
	};
	const requireTarget = (request: Request) => {
		if (
			!request.localization &&
			request.filter?.some((clause) => clause.field === "translation")
		)
			throw new GameTextLocalizationError({
				code: "invalid_selection",
				message: "Translation filters need a localization target.",
				recovery: "Select a localization target, or remove the translation filter."
			});
		if (request.localization) validateLocalizationSelection(joinHeader, request.localization);
	};
	const matching = (request: Request): Uint32Array => {
		requireTarget(request);
		const selection = request.localization;
		const order = selection ? lineOrder : rawOrder;
		const result = new Uint32Array(order.length);
		let count = 0;
		const wanted = terms(request.query),
			picked = request.lines === undefined ? undefined : new Set<string>(request.lines);
		const scope = cultureScope(selection);
		const { filter: _filter, ...unfiltered } = request;
		for (const row of order) {
			if (!selection) {
				if (eligible("raw", row, request, true, wanted)) result[count++] = row;
				continue;
			}
			if (!c("line.source_visible")[row]) continue;
			if (picked && !picked.has(data.lineId(row))) continue;
			if (
				request.filter !== undefined &&
				!matchesTextFilter(lineFacts(row, selection), request.filter)
			)
				continue;
			if (lineStarts[row] !== lineStarts[row + 1]) {
				let qualifies = false;
				for (let sr = lineStarts[row]!; sr < lineStarts[row + 1]!; sr++)
					if (eligible("slice", sr, unfiltered, false)) {
						qualifies = true;
						break;
					}
				if (!qualifies) continue;
			} else {
				if (
					request.capability === "source_editable" ||
					(request.lens !== undefined && request.lens !== "all") ||
					(request.withoutNotes && c("line.notes")[row])
				)
					continue;
				if (
					request.where?.kinds !== undefined &&
					!matchesTextKinds(origins(c("line.origins")[row]!), request.where.kinds)
				)
					continue;
				if (
					request.where?.pathPrefix !== undefined &&
					!matchesTextPathPrefix(
						lineFacts(row, selection).paths,
						request.where.pathPrefix
					)
				)
					continue;
				if (
					request.where?.files !== undefined &&
					!matchesTextFiles(
						lineFacts(row, selection).files.map(textFileKey),
						textFileScope(request.where.files)
					)
				)
					continue;
			}
			if (
				selection.review !== undefined &&
				!scope.some(
					(ci) =>
						reviewMask(row, ci) &
						(1 << LocalizationReviewLens.literals.indexOf(selection.review!))
				)
			)
				continue;
			if (
				selection.keyChanged &&
				!(c("line.key_change")[row]! > 0 && !(c("line.key_change")[row]! & 1))
			)
				continue;
			if (
				selection.state !== undefined &&
				!scope.some((ci) =>
					selection.state === "not_synced"
						? Boolean(cultureColumns[ci]!.facts![row]! & 8)
						: localizationStates[cultureColumns[ci]!.state![row]!] === selection.state
				)
			)
				continue;
			if (wanted.length) {
				const source = data.strings([c("line.source")[row]!])[0]!;
				const translation =
					selection.searchTranslations &&
					(selection.culture !== undefined || selection.cultures !== undefined)
						? data
								.line(row)
								.cultures.filter((_, ci) =>
									scoped(selection).some(({ index }) => index === ci)
								)
								.flatMap((mark) => [
									mark.archive?.translation.Text ?? "",
									mark.poTranslation ?? ""
								])
								.join(" ")
						: "";
				const searchable = `${source} ${translation}`.toLocaleLowerCase();
				if (!wanted.every((term) => searchable.includes(term))) continue;
			}
			result[count++] = row;
		}
		return result.subarray(0, count);
	};
	const rawCounts = (request: Request) => {
		const counts = emptyCounts();
		const {
			capability: _capability,
			lens: _lens,
			withoutNotes: _notes,
			where,
			...rest
		} = request;
		const { kinds: _kinds, ...withoutKinds } = where ?? {};
		const baseRequest: Request = { ...rest, capability: "all", where: withoutKinds };
		const wanted = terms(request.query);
		for (const row of rawOrder) {
			if (!eligible("raw", row, baseRequest, true, wanted)) continue;
			const flags = raw.signals![row]!,
				editing = raw.editing![row]!,
				noNotes = !raw.notes![row];
			const hasLens =
				request.lens === undefined ||
				request.lens === "all" ||
				Boolean(flags & (1 << querySignals.indexOf(request.lens)));
			const inKinds =
				request.where?.kinds === undefined ||
				matchesTextKinds(origins(raw.origins![row]!), request.where.kinds);
			const capability =
				request.capability === "all" ||
				Boolean(editing & (request.capability === "source_editable" ? 1 : 2));
			const notes = !request.withoutNotes || noNotes;
			if (hasLens && notes && inKinds && editing & 1) counts.editable++;
			if (hasLens && notes && inKinds && editing & 2) counts.readOnly++;
			if (hasLens && capability && inKinds && noNotes) counts.withoutNotes++;
			if (hasLens && capability && notes)
				for (let bit = 0; bit < TEXT_ORIGIN_KINDS.length; bit++)
					if (raw.origins![row]! & (1 << bit)) counts.origins[TEXT_ORIGIN_KINDS[bit]!]++;
			if (!hasLens || !capability || !notes || !inKinds) continue;
			counts.all++;
			for (let bit = 0; bit < 5; bit++)
				if (flags & (1 << bit)) counts[countedSignals[bit]!]++;
		}
		return counts;
	};
	const metadata = data.metadata(),
		baseline = rawCounts({ query: "", capability: "all" });
	const summary = {
		schemaVersion: 1,
		...metadata,
		counts: baseline,
		...(scannedAt === undefined ? undefined : { scannedAt }),
		searchable: {
			textUnits: baseline.all,
			textOccurrences: rawOrder.reduce(
				(sum, row) =>
					sum + (raw.visible![row] ? raw.member_end![row]! - raw.member_start![row]! : 0),
				0
			)
		},
		review: {
			all: baseline.all,
			shared: baseline.shared,
			duplicateSource: baseline.duplicate_source,
			long: baseline.long,
			unresolved: baseline.unresolved,
			conflicting: baseline.conflicting
		},
		sources: { assetProperty: 0, dataTable: 0, stringTable: 0, mixed: 0 }
	} satisfies TextCorpusQuerySummary;
	for (const row of rawOrder)
		if (raw.visible![row]) {
			const mask = raw.origins![row]!;
			if (mask & 4) summary.sources.assetProperty++;
			if (mask & 2) summary.sources.dataTable++;
			if (mask & 1) summary.sources.stringTable++;
			if ((mask & (mask - 1)) !== 0) summary.sources.mixed++;
		}
	const factsOf = (row: number, request: Request) =>
		request.localization ? lineFacts(row, request.localization) : entryFacts("raw", row);
	function* facts(rows: Uint32Array, request: Request) {
		for (const row of rows) yield factsOf(row, request);
	}
	const withoutField = (request: Request, field: TextFilterField): Request => {
		const { filter, ...rest } = request;
		const kept = filter?.filter((clause) => clause.field !== field);
		return kept?.length ? { ...rest, filter: kept } : rest;
	};
	const search: TextCorpusQuery["search"] = (request) => {
		const matched = matching(request),
			selection = request.localization;
		const base = (field: TextFilterField) =>
			request.filter?.some((clause) => clause.field === field)
				? matching(withoutField(request, field))
				: matched;
		const group = request.group;
		const listed =
			group === undefined || request.openGroup === undefined
				? matched
				: matched.filter(
						(row) => textGroupOf(factsOf(row, request), group).key === request.openGroup
					);
		const cursor = selection ? request.localizationCursor : request.cursor;
		const id = (row: number) => (selection ? data.lineId(row) : data.id(row));
		const after = cursor ? listed.findIndex((row) => id(row) === cursor) + 1 : 0;
		const page = listed.subarray(after, after + request.pageSize);
		const final = page.length ? id(page[page.length - 1]!) : undefined;
		const counts = selection ? emptyCounts() : rawCounts(request);
		if (selection) {
			counts.all = matched.length;
			for (const row of matched) {
				const flags = lineFlags(row),
					editing = c("line.editing")[row]!;
				if (editing & 1) counts.editable++;
				if (editing & 2) counts.readOnly++;
				if (!c("line.notes")[row]) counts.withoutNotes++;
				for (let bit = 0; bit < 5; bit++)
					if (flags & (1 << bit)) counts[countedSignals[bit]!]++;
			}
			const { kinds: _kinds, ...where } = request.where ?? {};
			const originBase =
				request.where?.kinds === undefined ? matched : matching({ ...request, where });
			for (const row of originBase)
				for (const origin of origins(c("line.origins")[row]!)) counts.origins[origin]++;
		}
		let localization: LocalizationQueryPage | undefined;
		if (selection) {
			const countedCultures = selection.cultures ?? target.cultures;
			const tallies = countedCultures.map((culture) => ({
				culture,
				states: Object.fromEntries(
					localizationStates.map((state) => [state, { lines: 0, sourceWords: 0 }])
				),
				unknownReasons: Object.fromEntries(
					LocalizationUnknownReason.literals.map((reason) => [reason, 0])
				),
				reducedSourceChecking: 0
			}));
			const stateCounts = Object.fromEntries(localizationStates.map((state) => [state, 0]));
			const reviewCounts = Object.fromEntries(
				LocalizationReviewLens.literals.map((lens) => [lens, 0])
			);
			let notSynced = 0,
				keyChanged = 0,
				reviewed = false;
			const scope = cultureScope(selection),
				tallyIndices = countedCultures.map((culture) => target.cultures.indexOf(culture));
			for (const row of matched) {
				for (let ti = 0; ti < tallies.length; ti++) {
					const tally = tallies[ti]!,
						ci = tallyIndices[ti]!,
						columns = cultureColumns[ci]!;
					const state = localizationStates[columns.state![row]!]!;
					tally.states[state]!.lines++;
					tally.states[state]!.sourceWords += c("line.source_words")[row]!;
					let reasons = columns.reasons![row]!;
					while (reasons) {
						const bit = 31 - Math.clz32(reasons & -reasons);
						tally.unknownReasons[LocalizationUnknownReason.literals[bit]!]!++;
						reasons &= reasons - 1;
					}
					if (joined.meta.reducedSourceChecking[ci]) tally.reducedSourceChecking++;
				}
				let states = 0,
					reviews = 0;
				for (const ci of scope) {
					const columns = cultureColumns[ci]!,
						state = columns.state![row]!;
					if (state !== 3) states |= 1 << state;
					if (columns.facts![row]! & 8) {
						states |= 8;
						notSynced++;
					}
					reviews |= reviewMask(row, ci);
				}
				for (let bit = 0; bit < localizationStates.length; bit++)
					if (states & (1 << bit)) stateCounts[localizationStates[bit]!]!++;
				if (c("line.key_change")[row]! > 0 && !(c("line.key_change")[row]! & 1))
					keyChanged++;
				if (!reviewed)
					for (const columns of cultureColumns)
						if (columns.review![row]) {
							reviewed = true;
							break;
						}
				for (let bit = 0; bit < LocalizationReviewLens.literals.length; bit++)
					if (reviews & (1 << bit))
						reviewCounts[LocalizationReviewLens.literals[bit]!]!++;
			}
			localization = Schema.decodeUnknownSync(LocalizationQueryPage)({
				target: target.name,
				counts: tallies,
				stateCounts,
				notSynced,
				lines: Array.from(page, (row) => localizationLinePreview(data.line(row))),
				...(reviewed ? { reviewCounts } : undefined),
				...(keyChanged || selection.keyChanged ? { keyChanged } : undefined),
				...(final !== undefined && after + page.length < listed.length
					? { nextCursor: LocalizationLineId.make(final) }
					: undefined)
			});
		}
		const facets = request.facets;
		const cultureBase = () => {
			if (!selection || selection.cultures === undefined) return matched;
			const { cultures: _cultures, ...unscoped } = selection;
			return matching({ ...request, localization: unscoped });
		};
		const fileScope = textFileScope(request.where?.files);
		const filesWithText = function* () {
			for (const row of matched) yield* factsOf(row, request).files.map(textFileKey);
		};
		return {
			counts,
			total: matched.length,
			problems: textProblemCounts(
				(function* () {
					for (const row of base("problem")) yield factsOf(row, request).problems;
				})()
			),
			...(group === undefined
				? undefined
				: { groups: { by: group, ...textGroups(facts(matched, request), group) } }),
			...(facets === undefined
				? undefined
				: {
						facets: {
							...(facets.folder === undefined
								? undefined
								: {
										folders: {
											under: facets.folder,
											...textFolderFacet(
												facts(base("folder"), request),
												facets.folder
											)
										}
									}),
							...(facets.assets
								? { assets: textAssetFacet(facts(base("asset"), request)) }
								: undefined),
							...(facets.origins
								? { origins: textOriginFacet(facts(base("origin"), request)) }
								: undefined),
							...(facets.cultures && selection
								? {
										cultures: textCultureFacet(
											(function* () {
												for (const row of cultureBase()) yield marks(row);
											})(),
											target.cultures
										)
									}
								: undefined)
						}
					}),
			...(fileScope === undefined
				? undefined
				: {
						fileScope: textFileScopeSummary(
							fileScope,
							filesWithText(),
							joined.meta.packageNames.flatMap((_, shard) =>
								data.strings(Array.from(data.packageColumn(shard, "package.path")))
							)
						)
					}),
			...(localization === undefined ? undefined : { localization }),
			units: selection
				? Array.from(page).flatMap((row) => {
						for (let sr = lineStarts[row]!; sr < lineStarts[row + 1]!; sr++)
							if (slice.visible![sr])
								return [
									{
										...data.presentation("slice", sr),
										localization:
											localization!.lines[Array.from(page).indexOf(row)]!
												.cultures
									}
								];
						return [];
					})
				: Array.from(page, (row) => data.presentation("raw", row)),
			...(!selection && final !== undefined && after + page.length < listed.length
				? { nextCursor: TextUnitId.make(final) }
				: undefined)
		};
	};
	const findRaw = (id: string) => rawOrder.find((row) => data.id(row) === id);
	const findLine = (id: string) => lineOrder.find((row) => data.lineId(row) === id);
	return {
		summary: () => summary,
		search,
		localizationFocus: (id) => {
			const row = findLine(id);
			return row === undefined ? undefined : data.line(row);
		},
		localizationLines: (request) => {
			if (!request.localization)
				throw new GameTextLocalizationError({
					code: "invalid_selection",
					message: "Localization evidence has not been supplied to this query.",
					recovery:
						"Load and join the selected target before querying its localization state."
				});
			return Array.from(matching(request), (row) => data.line(row));
		},
		export: (request) => {
			const rows = matching(request),
				chosen = new Set<number>();
			if (request.localization)
				for (const row of rows)
					for (let sr = lineStarts[row]!; sr < lineStarts[row + 1]!; sr++)
						chosen.add(c("query.slice.raw")[sr]!);
			else for (const row of rows) chosen.add(row);
			return {
				...data.exportMetadata(),
				schemaVersion: 1,
				status: metadata.status,
				coverage: metadata.coverage,
				units: Array.from(rawOrder)
					.filter((row) => chosen.has(row))
					.map((row) => data.unit("raw", row))
			};
		},
		focus: (request) => {
			if (request.localization && request.localization.target !== target.name)
				return undefined;
			let kind: "raw" | "slice" = "raw",
				row = findRaw(request.id),
				lineRow: number | undefined;
			if (request.localization) {
				lineRow = findLine(request.localization.id);
				if (lineRow === undefined) return undefined;
				kind = "slice";
				row = undefined;
				for (let sr = lineStarts[lineRow]!; sr < lineStarts[lineRow + 1]!; sr++)
					if (data.id(c("query.slice.raw")[sr]!) === request.id && slice.visible![sr]) {
						row = sr;
						break;
					}
			} else if (row !== undefined) {
				if (!raw.visible![row]) return undefined;
				for (const candidate of lineOrder) {
					let found = false;
					for (let sr = lineStarts[candidate]!; sr < lineStarts[candidate + 1]!; sr++)
						if (c("query.slice.raw")[sr] === row) found = true;
					if (found) lineRow = candidate;
				}
			}
			if (row === undefined) return undefined;
			const members = data.members(kind, row);
			const after = request.occurrenceCursor
				? members.findIndex(
						(member) => data.occurrence(member).id === request.occurrenceCursor
					) + 1
				: 0;
			const occurrences = Array.from(
				members.subarray(after, after + request.pageSize),
				(member) => data.occurrence(member)
			);
			return {
				diagnostics: data.diagnostics(members).slice(0, request.pageSize),
				occurrences,
				totalOccurrences: members.length,
				unit: data.presentation(kind, row),
				...(lineRow === undefined ? undefined : { localization: data.line(lineRow) }),
				...(occurrences.length && after + occurrences.length < members.length
					? { nextOccurrenceCursor: occurrences[occurrences.length - 1]!.id }
					: undefined)
			};
		}
	};
}
