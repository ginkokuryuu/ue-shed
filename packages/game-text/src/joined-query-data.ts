import {
	SavedAssetPackageTextEvent,
	type SavedAssetMissingGatherableText,
	type SavedAssetPackageTextRecord,
	type SavedAssetTextCoverageGap
} from "@ue-shed/unreal-assets";
import { decodeWtf8, encodeWtf8 } from "./wtf8.js";
import { relative, resolve } from "node:path";
import { Cache, Effect, Schema } from "effect";
import { textOccurrenceFromExtraction, textCorpusFromExtractionEvents } from "./corpus.js";
import { emptyPackageTextRecord } from "./package-text-record.js";
import { packageTextGapReasons, decodePackageTextColumns } from "./package-text-columns.js";
import { textCorpusWithExcludedPackages } from "./package-text-candidates.js";
import { comparePackageTextPathBytes } from "./package-text-order.js";
import { TextUnitId } from "./identifiers.js";
import { hydrateJoinedTarget, type JoinedTargetReader } from "./joined-target-reader.js";
import { synchronousJoinedTarget } from "./joined-query-reader.js";
import { sourcePatchKind } from "./joined-source-patches.js";
import { runJoinedQuery } from "./joined-query-node.js";
import { snapshotCheck } from "./snapshot-format.js";
import { u32 } from "./joined-target-input.js";
import {
	MAX_CORPUS_REPORT_ITEMS,
	type TextCorpusDiagnosticSummary,
	type TextPackageCoverageSummary
} from "./corpus-summary.js";
import type { TextUnit, TextOccurrence, TextUnitSearchResult, TextReviewSignal } from "./schema.js";
import {
	LocalizationLineId,
	LocalizationEvidenceLineId,
	LocalizationUnknownReason,
	localizationStates,
	type LocalizationLinePreview
} from "./localization-schema.js";
import { LocalizationIdentity } from "@ue-shed/localization/browser";
import { StringArena } from "./shared-string-codec.js";
import {
	readJoinedSourceCache,
	addSourceTrigrams,
	rejectSourceTrigrams,
	type JoinedSourceCache
} from "./joined-source-cache.js";

type MutableDiagnosticCounts = {
	-readonly [K in keyof TextCorpusDiagnosticSummary["diagnosticCounts"]]: TextCorpusDiagnosticSummary["diagnosticCounts"][K];
};
type MutablePackageCounts = {
	-readonly [K in keyof TextPackageCoverageSummary["counts"]]: TextPackageCoverageSummary["counts"][K];
};

export const querySignals = [
	"shared",
	"duplicate_source",
	"long",
	"unresolved",
	"conflicting",
	"evidence_only"
] as const satisfies readonly TextReviewSignal[];

/** The largest page hydrateJoinedTarget accepts. */
const MAX_HYDRATED_PAGE_LINES = 10000;
/** Bulk reads hydrate across gaps up to this many rows instead of starting a new page. */
const MAX_BRIDGED_ROW_GAP = 64;

const displayedLines = (joined: JoinedTargetReader) =>
	runJoinedQuery(
		Cache.make({
			capacity: 64,
			lookup: (row: number) =>
				Effect.scoped(hydrateJoinedTarget(joined, row, 1)).pipe(
					Effect.map((page) => page.lines[0]!)
				)
		})
	);

/** Immutable numeric/byte projections may outlive a reader; they contain no file handles. */
export interface JoinedQueryProjection {
	readonly columns: Map<string, Uint32Array>;
	readonly generation?: string;
	readonly base?: string;
	readonly key?: string;
	sourceSeed?: JoinedQueryProjection["sources"];
	sources?: JoinedSourceCache;
}

/** Copy only immutable physical columns still referenced by this generation. Patched and
 * derived columns remain private to each query; old readers keep their original buffers. */
export function reuseJoinedQueryProjection(
	joined: JoinedTargetReader,
	previous?: JoinedQueryProjection
): JoinedQueryProjection {
	const generation = joined.reader.manifest.generation,
		key = joined.reader.manifest.active.joined!,
		base = joined.meta.base ?? key;
	const columns = new Map<string, Uint32Array>();
	const compatible = previous?.generation === generation && previous.base === base;
	if (compatible) {
		const retained = new Set([base, ...Object.values(joined.meta.dependencies)]);
		for (const [name, values] of previous.columns) {
			if (!name.startsWith("layer:")) continue;
			const end = name.lastIndexOf("\0");
			if (retained.has(name.slice(6, end))) columns.set(name, values);
		}
	}
	return {
		generation,
		base,
		key,
		columns,
		...(compatible && previous.sources ? { sourceSeed: previous.sources } : undefined)
	};
}

/** Column and bounded row access for the synchronous public API. No corpus is materialized. */
export class JoinedQueryData {
	readonly joined: JoinedTargetReader;
	private readonly columns: Map<string, Uint32Array>;
	readonly projection: JoinedQueryProjection;
	private readonly displayedLines: ReturnType<typeof displayedLines>;
	constructor(joined: JoinedTargetReader, projection?: JoinedQueryProjection) {
		this.joined = synchronousJoinedTarget(joined);
		this.projection = projection ?? { columns: new Map() };
		this.columns = this.projection.columns;
		this.displayedLines = displayedLines(this.joined);
	}
	column(name: string) {
		// Unpatched aliases share one buffer. A patched logical column must not replace
		// the base buffer still used by other aliases in this pinned generation.
		const key =
			this.joined.meta.patches?.[name] ||
			sourcePatchKind(name, this.joined.meta.sourcePatches)
				? `patch:${name}`
				: `layer:${this.joined.meta.base ?? this.joined.reader.manifest.active.joined}\0${this.joined.meta.aliases[name] ?? name}`;
		let value = this.columns.get(key);
		if (!value) {
			value = runJoinedQuery(u32(this.joined.layer, name));
			this.columns.set(key, value);
		}
		return value;
	}
	strings(ids: readonly number[]) {
		return this.joined.reader.stringsSync!(ids);
	}
	/** Expand encoded source bytes once. Text search never repeatedly inflates A64 blocks. */
	prepareSources() {
		if (this.projection.sources || !this.joined.reader.bytesSync) return;
		const last = this.joined.reader.manifest.segments.at(-1);
		const selected = new Uint8Array(last ? last.start + last.count : 0);
		for (const id of this.column("line.source")) selected[id] = 1;
		for (const id of this.column("query.raw.sources")) selected[id] = 1;
		if (!this.projection.sourceSeed && this.joined.meta.sourceCache) {
			const bytes = runJoinedQuery(this.joined.layer.section("query.source.bytes"));
			snapshotCheck(bytes instanceof Uint8Array, "query.source.bytes", "Expected byte cache");
			const trigrams = this.joined.meta.sourceCache.trigramVersion
				? runJoinedQuery(this.joined.layer.section("query.source.trigrams"))
				: undefined;
			snapshotCheck(
				trigrams === undefined || trigrams instanceof Uint8Array,
				"query.source.trigrams",
				"Expected byte index"
			);
			const flags = this.joined.meta.sourceCache.flagsVersion
				? runJoinedQuery(this.joined.layer.section("query.source.simple"))
				: undefined;
			snapshotCheck(
				flags === undefined || flags instanceof Uint8Array,
				"query.source.simple",
				"Expected byte flags"
			);
			const cached = readJoinedSourceCache(
				this.joined.meta.sourceCache,
				this.column("query.source.ids"),
				this.column("query.source.starts"),
				bytes,
				selected.length,
				trigrams,
				flags
			);
			if (!this.joined.meta.base) {
				let count = 0;
				for (const present of selected) count += present;
				snapshotCheck(
					count === cached.ids.length,
					"query.source",
					"Source cache selection differs"
				);
				for (const id of cached.ids)
					snapshotCheck(selected[id] === 1, "query.source", "Source cache ID is unused");
				this.projection.sources = cached;
				return;
			}
			this.projection.sourceSeed = cached;
		}
		const seed = this.projection.sourceSeed;
		this.projection.sourceSeed = undefined;
		if (seed) {
			const added: number[] = [];
			let obsolete = 0,
				obsoleteBytes = 0;
			for (let row = 0; row < seed.ids.length; row++)
				if (!selected[seed.ids[row]!]) {
					obsolete++;
					obsoleteBytes += seed.packed.offsets[row + 1]! - seed.packed.offsets[row]!;
				}
			for (let id = 0; id < selected.length; id++)
				if (selected[id] && !seed.index[id]) added.push(id);
			// Keep stale source bytes bounded even across many edits of one identity.
			if (added.length <= 8192 && obsolete <= 8192 && obsoleteBytes <= 32 * 1024 ** 2) {
				const index = new Uint32Array(selected.length);
				index.set(seed.index.subarray(0, index.length));
				if (!added.length) {
					this.projection.sources = { ...seed, index };
					return;
				}
				const arena = new StringArena();
				for (const id of added) arena.add(this.joined.reader.bytesSync(id));
				const extra = arena.finish();
				const bytes = Buffer.concat([seed.packed.bytes, extra.bytes]);
				const offsets = new Float64Array(seed.ids.length + added.length + 1);
				offsets.set(seed.packed.offsets);
				for (let row = 0; row <= added.length; row++)
					offsets[seed.ids.length + row] = seed.packed.bytes.length + extra.offsets[row]!;
				const ids = new Uint32Array(seed.ids.length + added.length),
					simple = new Uint8Array(ids.length),
					trigrams = seed.trigrams?.slice();
				ids.set(seed.ids);
				simple.set(seed.simple);
				for (let row = 0; row < added.length; row++) {
					const id = added[row]!,
						position = seed.ids.length + row;
					ids[position] = id;
					index[id] = position + 1;
					const value = extra.bytes.subarray(extra.offsets[row], extra.offsets[row + 1]);
					simple[position] = Number(
						!value.some((byte) => byte >= 128 || (byte >= 65 && byte <= 90))
					);
					if (trigrams && simple[position]) addSourceTrigrams(trigrams, value);
				}
				this.projection.sources = {
					packed: { bytes, offsets },
					index,
					ids,
					simple,
					...(trigrams ? { trigrams } : undefined)
				};
				return;
			}
		}
		const index = new Uint32Array(selected.length),
			arena = new StringArena();
		let count = 0;
		for (let id = 0; id < selected.length; id++)
			if (selected[id]) {
				index[id] = ++count;
				arena.add(this.joined.reader.bytesSync(id));
			}
		const expanded = arena.finish(),
			packed = {
				...expanded,
				bytes:
					expanded.bytes.buffer.byteLength > expanded.bytes.length * 1.25
						? Buffer.from(expanded.bytes)
						: expanded.bytes
			},
			ids = new Uint32Array(count),
			simple = new Uint8Array(count);
		for (let id = 0; id < index.length; id++)
			if (index[id]) {
				const row = index[id]! - 1;
				ids[row] = id;
				const bytes = packed.bytes.subarray(packed.offsets[row], packed.offsets[row + 1]);
				simple[row] = Number(
					!bytes.some((byte) => byte >= 128 || (byte >= 65 && byte <= 90))
				);
			}
		this.projection.sources = { packed, index, ids, simple };
	}
	/** Lowercase ASCII sources cannot contain a non-ASCII search term, even after locale folding. */
	rejectAsciiSources(checkInterrupted?: () => void): Uint8Array | undefined {
		const source = this.projection.sources;
		if (!source) return undefined;
		const result = new Uint8Array(source.index.length);
		for (let row = 0; row < source.ids.length; row++) {
			if ((row & 255) === 0) checkInterrupted?.();
			if (source.simple[row]) result[source.ids[row]!] = 2;
		}
		return result;
	}
	/** Native byte scans find ASCII terms without allocating one string/view per source. */
	searchSourceBytes(
		terms: readonly Buffer[],
		checkInterrupted?: () => void
	): Uint8Array | undefined {
		const source = this.projection.sources;
		if (!source) return undefined;
		if (source.trigrams && rejectSourceTrigrams(source.trigrams, terms))
			return this.rejectAsciiSources(checkInterrupted);
		const counts = new Uint32Array(source.ids.length),
			offsets = source.packed.offsets,
			bytes = source.packed.bytes;
		for (const term of terms) {
			let row = 0,
				position = 0;
			for (;;) {
				if ((row & 255) === 0) checkInterrupted?.();
				const found = bytes.indexOf(term, position);
				if (found < 0) break;
				while (row < counts.length && offsets[row + 1]! <= found) row++;
				if (row >= counts.length) break;
				if (found + term.length <= offsets[row + 1]!) {
					counts[row]!++;
					position = offsets[row + 1]!;
				} else position = found + 1;
			}
		}
		const result = new Uint8Array(source.index.length);
		for (let row = 0; row < source.ids.length; row++)
			result[source.ids[row]!] =
				counts[row] === terms.length ? 1 : source.simple[row] ? 2 : 0;
		return result;
	}
	sourceBytes(id: number): Uint8Array | undefined {
		const source = this.projection.sources,
			row = source?.index[id];
		return row
			? source!.packed.bytes.subarray(
					source!.packed.offsets[row - 1],
					source!.packed.offsets[row]
				)
			: this.joined.reader.bytesSync?.(id);
	}
	packageColumn(shard: number, field: string) {
		const dependency = this.joined.meta.dependencies[this.joined.meta.packageNames[shard]!]!;
		const key = `layer:${dependency}\0${field}`;
		let value = this.columns.get(key);
		if (!value) {
			const opened = this.joined.reader.layerSync!(this.joined.meta.packageNames[shard]!);
			const column = opened.section(field);
			snapshotCheck(column instanceof Uint32Array, field, "Expected u32 column");
			value = column;
			this.columns.set(key, value);
		}
		return value;
	}
	occurrence(global: number): TextOccurrence {
		const starts = this.joined.meta.packageStarts;
		let shard = 0;
		while (starts[shard + 1]! <= global) shard++;
		const row = global - starts[shard]!;
		const c = (field: string) => this.packageColumn(shard, `occurrence.${field}`)[row]!;
		const fields = [
			"source",
			"notes",
			"namespace",
			"key",
			"object",
			"property",
			"class",
			"row"
		];
		const values = this.strings(fields.map(c));
		const s = (field: string) => values[fields.indexOf(field)]!;
		const packageStarts = this.packageColumn(shard, "package.occurrence_start");
		let low = 0,
			high = packageStarts.length - 2;
		while (low < high) {
			const mid = (low + high + 1) >>> 1;
			if (packageStarts[mid]! <= row) low = mid;
			else high = mid - 1;
		}
		const path = this.strings([this.packageColumn(shard, "package.path")[low]!])[0]!;
		const projectRoot = this.joined.meta.input.projectRoot;
		const identity = c("identity"),
			location = c("location");
		return textOccurrenceFromExtraction({
			packageFile: relative(projectRoot, resolve(projectRoot, path)),
			occurrence: {
				source: s("source"),
				dev_notes: s("notes"),
				identity:
					identity === 0
						? { status: "resolved", namespace: s("namespace"), key: s("key") }
						: identity === 1
							? { status: "string_table", table_id: s("namespace"), key: s("key") }
							: {
									status: "unresolved",
									reason: identity === 2 ? "culture_invariant" : "missing_key"
								},
				location:
					location === 0
						? {
								kind: "asset_property",
								object_path: s("object"),
								property_path: s("property"),
								class_path: s("class")
							}
						: location === 1
							? {
									kind: "data_table_cell",
									object_path: s("object"),
									property_path: s("property"),
									row: s("row")
								}
							: {
									kind: "string_table_entry",
									object_path: s("object"),
									entry_key: s("row")
								},
				edit_capability: c("editable") ? "source_editable" : "read_only"
			}
		});
	}
	members(kind: "raw" | "slice", row: number) {
		const prefix = `query.${kind}.`;
		return this.column(prefix + "members").subarray(
			this.column(prefix + "member_start")[row]!,
			this.column(prefix + "member_end")[row]!
		);
	}
	id(row: number): TextUnit["id"] {
		const starts = this.column("query.raw.id_starts"),
			bytes = this.column("query.raw.id_utf8");
		return TextUnitId.make(
			decodeWtf8(
				new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).subarray(
					starts[row],
					starts[row + 1]
				)
			)
		);
	}
	lineId(row: number) {
		const starts = this.column("query.line.id_starts"),
			bytes = this.column("query.line.id_utf8");
		return decodeWtf8(
			new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).subarray(
				starts[row],
				starts[row + 1]
			)
		);
	}
	/** Compare exact ID bytes; focus and cursors never decode all identities. */
	findId(kind: "raw" | "line", id: string): number | undefined {
		const starts = this.column(`query.${kind}.id_starts`),
			values = this.column(`query.${kind}.id_utf8`);
		const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength),
			wanted = encodeWtf8(id);
		for (let row = 0; row + 1 < starts.length; row++) {
			const start = starts[row]!;
			if (starts[row + 1]! - start !== wanted.length) continue;
			let index = 0;
			while (index < wanted.length && bytes[start + index] === wanted[index]) index++;
			if (index === wanted.length) return row;
		}
		return undefined;
	}
	unit(kind: "raw" | "slice", row: number): TextUnit {
		const prefix = `query.${kind}.`;
		const occurrences = Array.from(this.members(kind, row), (member) =>
			this.occurrence(member)
		);
		const values = this.strings(
			Array.from(
				this.column(prefix + "sources").subarray(
					this.column(prefix + "source_start")[row]!,
					this.column(prefix + "source_end")[row]!
				)
			)
		);
		return {
			id: this.id(this.column(prefix + "raw")[row]!),
			identity: occurrences[0]!.identity,
			source:
				values.length === 1
					? { status: "consistent", value: values[0]! }
					: { status: "conflicting", values },
			occurrences
		};
	}
	presentation(kind: "raw" | "slice", row: number): TextUnitSearchResult {
		const prefix = `query.${kind}.`;
		const members = this.members(kind, row);
		const contexts = Array.from(members.subarray(0, 3), (member) => {
			const occurrence = this.occurrence(member);
			return { editCapability: occurrence.editCapability, location: occurrence.location };
		});
		const first = this.occurrence(this.column(prefix + "representative")[row]!);
		const values = this.strings(
			Array.from(
				this.column(prefix + "sources").subarray(
					this.column(prefix + "source_start")[row]!,
					this.column(prefix + "source_end")[row]!
				)
			)
		);
		const origins = this.column(prefix + "origins")[row]!;
		return {
			id: this.id(this.column(prefix + "raw")[row]!),
			identity: first.identity,
			source:
				values.length === 1
					? { status: "consistent", value: values[0]! }
					: { status: "conflicting", values },
			contexts,
			occurrenceCount: members.length,
			remainingContextCount: Math.max(0, members.length - contexts.length),
			characterCount: this.column(prefix + "characters")[row]!,
			wordCount: this.column(prefix + "words")[row]!,
			reviewSignals: querySignals.filter(
				(_, bit) => this.column(prefix + "signals")[row]! & (1 << bit)
			),
			locationKinds: [
				...(origins & 4 ? ["asset_property" as const] : []),
				...(origins & 2 ? ["data_table_cell" as const] : []),
				...(origins & 1 ? ["string_table_entry" as const] : [])
			]
		};
	}
	line(row: number): Effect.Success<ReturnType<typeof hydrateJoinedTarget>>["lines"][number] {
		return runJoinedQuery(Cache.get(this.displayedLines, row));
	}
	/** Bulk reads hydrate rows in storage order, in pages of adjacent rows, then return them in
	 * the requested (display) order. One page per row costs minutes on a large target because
	 * every page re-reads shared string blocks. Bypasses the displayed-line cache, which only
	 * serves paged browsing. */
	lines(rows: ArrayLike<number>): ReturnType<JoinedQueryData["line"]>[] {
		const sorted = Uint32Array.from(new Set(Array.from(rows))).sort();
		const byRow = new Map<number, ReturnType<JoinedQueryData["line"]>>();
		for (let index = 0; index < sorted.length; ) {
			const start = sorted[index]!;
			let last = index;
			// A page may span small gaps: reading a few unrequested rows beats another page.
			while (
				last + 1 < sorted.length &&
				sorted[last + 1]! - start < MAX_HYDRATED_PAGE_LINES &&
				sorted[last + 1]! - sorted[last]! <= MAX_BRIDGED_ROW_GAP
			)
				last++;
			const page = runJoinedQuery(
				Effect.scoped(hydrateJoinedTarget(this.joined, start, sorted[last]! - start + 1))
			);
			for (let picked = index; picked <= last; picked++)
				byRow.set(sorted[picked]!, page.lines[sorted[picked]! - start]!);
			index = last + 1;
		}
		return Array.from(rows, (row) => byRow.get(row)!);
	}
	fileColumn(name: string, field: string): Uint32Array {
		const key = `layer:${this.joined.meta.dependencies[name]}\0entry.${field}`;
		let value = this.columns.get(key);
		if (!value) {
			const opened = this.joined.reader.layerSync!(this.joined.meta.dependencies[name]!);
			const column = opened.section(`entry.${field}`);
			snapshotCheck(column instanceof Uint32Array, field, "Expected localization column");
			this.columns.set(key, column);
			value = column;
		}
		return value;
	}
	translationId(name: string, row: number, po = false): number | undefined {
		const options = this.fileColumn(name, "options")[row]!;
		if (po && !(options & 64)) return undefined;
		return this.fileColumn(name, options & 128 ? "source" : "translation")[row]!;
	}
	/** Text search decodes only selected source/translation values, never full evidence rows. */
	searchableTranslations(row: number, scope: readonly number[]) {
		const target = this.joined.meta.input.target,
			ids = [this.column("line.source")[row]!];
		for (const ci of scope) {
			const culture = target.cultures[ci]!,
				archive = this.column(`c${ci}.archive`)[row]!;
			if (archive)
				ids.push(this.translationId(target.outputPaths.archives[culture]!, archive - 1)!);
			if (this.column(`c${ci}.facts`)[row]! & 8) {
				const po = this.column(`c${ci}.po`)[row]!;
				const translation = po
					? this.translationId(target.outputPaths.portableObjects[culture]!, po - 1, true)
					: undefined;
				if (translation !== undefined) ids.push(translation);
			}
		}
		return this.strings(ids).join(" ").toLocaleLowerCase();
	}
	/** Pages need only coordinates, state marks and displayed translations, never full PO entries. */
	preview(row: number): LocalizationLinePreview {
		const target = this.joined.meta.input.target,
			c = (name: string) => this.column(name)[row]!;
		const id = LocalizationLineId.make(this.lineId(row));
		const source = this.strings([c("line.source")])[0]!;
		const starts = this.column("query.line.starts"),
			raws = this.column("query.slice.raw");
		const units = new Set<TextUnit["id"]>();
		for (let sr = starts[row]!; sr < starts[row + 1]!; sr++) units.add(this.id(raws[sr]!));
		const [namespace, key] = this.strings([c("line.namespace"), c("line.key")]);
		const identity =
			units.size && key === ""
				? null
				: Schema.decodeUnknownSync(LocalizationIdentity)({
						namespace: namespace!,
						key: key!
					});
		const begin = c("line.manifest_start"),
			end = c("line.manifest_end"),
			manifestRows = this.column("manifest.rows");
		const manifestLocations: string[] = [];
		for (let offset = begin; offset < Math.min(begin + 3, end); offset++) {
			const name = target.outputPaths.manifest!,
				entry = manifestRows[offset]!;
			const path = this.strings([this.fileColumn(name, "path")[entry]!])[0]!;
			if (this.fileColumn(name, "options")[entry]! & 1024) {
				const file = this.joined.reader.layerSync!(this.joined.meta.dependencies[name]!);
				const meta = Schema.decodeUnknownSync(
					Schema.fromJsonString(
						Schema.Struct({ pathPrefix: Schema.optionalKey(Schema.String) })
					)
				)(new TextDecoder().decode(file.section("file.meta")));
				manifestLocations.push((meta.pathPrefix ?? "") + path);
			} else manifestLocations.push(path);
		}
		const change = c("line.key_change"),
			pair = this.joined.meta.pairs[(change >>> 1) - 1];
		return {
			id,
			source,
			identity,
			manifestLocations,
			remainingLocationCount: Math.max(0, end - begin - 3),
			origin: units.size
				? { kind: "corpus", unitIds: [...units].sort() }
				: { kind: "evidence", id: LocalizationEvidenceLineId.make(`evidence:${id}`) },
			...(pair
				? {
						keyChange: {
							direction: change & 1 ? "from" : "to",
							other: change & 1 ? pair.to : pair.from,
							match: pair.match,
							sourceChanged: pair.sourceChanged,
							previousSource: pair.previousSource,
							translations: pair.translations
						}
					}
				: undefined),
			cultures: target.cultures.map((culture, ci) => {
				const prefix = `c${ci}.`,
					facts = c(prefix + "facts"),
					review = c(prefix + "review"),
					record =
						this.joined.meta.input.review?.records[c(prefix + "review_record") - 1];
				const notSynced = Boolean(facts & 8),
					entry = c(prefix + (notSynced ? "po" : "archive"));
				const translation = entry
					? this.translationId(
							(notSynced
								? target.outputPaths.portableObjects
								: target.outputPaths.archives)[culture]!,
							entry - 1,
							notSynced
						)
					: undefined;
				return {
					culture,
					state: localizationStates[c(prefix + "state")]!,
					facts: localizationStates.filter((_, bit) => facts & (1 << bit)),
					unknownReasons: LocalizationUnknownReason.literals.filter(
						(_, bit) => c(prefix + "reasons") & (1 << bit)
					),
					reducedSourceChecking: this.joined.meta.reducedSourceChecking[ci]!,
					translation:
						translation === undefined
							? notSynced
								? ""
								: null
							: this.strings([translation])[0]!,
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
			})
		};
	}
	/** Rebuilds the stored coverage evidence of one inspected package, without its occurrences. */
	private packageRecord(shard: number, row: number, path: string): SavedAssetPackageTextRecord {
		const record = emptyPackageTextRecord(path);
		const gapCounts = { ...record.gapCounts };
		for (let index = 0; index < packageTextGapReasons.length; index++)
			gapCounts[packageTextGapReasons[index]!] = this.packageColumn(
				shard,
				`package.gap${index}`
			)[row]!;
		const gapStarts = this.packageColumn(shard, "package.gap_start");
		const gapSamples: SavedAssetTextCoverageGap[] = [];
		for (let gap = gapStarts[row]!; gap < gapStarts[row + 1]!; gap++) {
			const values = this.strings([
				this.packageColumn(shard, "gap.object")[gap]!,
				this.packageColumn(shard, "gap.property")[gap]!
			]);
			gapSamples.push({
				reason: packageTextGapReasons[this.packageColumn(shard, "gap.reason")[gap]!]!,
				object_path: values[0]!,
				property_path: values[1]!
			});
		}
		const missingStarts = this.packageColumn(shard, "package.missing_start");
		const missingSamples: SavedAssetMissingGatherableText[] = [];
		for (let index = missingStarts[row]!; index < missingStarts[row + 1]!; index++) {
			const [namespace, key, source, site] = this.strings([
				this.packageColumn(shard, "missing.namespace")[index]!,
				this.packageColumn(shard, "missing.key")[index]!,
				this.packageColumn(shard, "missing.source")[index]!,
				this.packageColumn(shard, "missing.site")[index]!
			]);
			missingSamples.push({ namespace: namespace!, key: key!, source: source!, site: site! });
		}
		return {
			...record,
			status: this.packageColumn(shard, "package.status")[row] === 1 ? "partial" : "complete",
			decodeErrors: this.packageColumn(shard, "package.decode_errors")[row]!,
			gapCounts,
			gapSamples,
			...(this.packageColumn(shard, "package.gather")[row] === 1
				? {
						gatherCoverage: {
							runtimeSites: this.packageColumn(shard, "package.gather_sites")[row]!,
							missing: this.packageColumn(shard, "package.gather_missing")[row]!,
							missingSamples
						}
					}
				: undefined)
		};
	}
	metadata() {
		let discoveredPackages = 0,
			inspectedPackages = 0,
			partialPackages = 0,
			failedPackages = 0,
			unsupportedTextProperties = 0,
			missingGatherableText = 0,
			diagnosticCount = 0,
			notGatherablePackages = 0,
			resolvedOccurrences = 0;
		for (let shard = 0; shard < this.joined.meta.packageNames.length; shard++) {
			const statuses = this.packageColumn(shard, "package.status");
			const histories = this.packageColumn(shard, "package.gap0");
			const missing = this.packageColumn(shard, "package.gather_missing");
			const starts = this.packageColumn(shard, "package.gap_start");
			const missingStarts = this.packageColumn(shard, "package.missing_start");
			const reasons = this.packageColumn(shard, "gap.reason");
			discoveredPackages += statuses.length;
			for (let row = 0; row < statuses.length; row++) {
				if (statuses[row]! < 2) inspectedPackages++;
				if (statuses[row] === 3) {
					failedPackages++;
					diagnosticCount++;
				}
				if (statuses[row] === 2) {
					notGatherablePackages++;
					diagnosticCount++;
				}
				// Gaps in complete packages are detail; the reader's status decides coverage.
				if (statuses[row] !== 1) continue;
				partialPackages++;
				diagnosticCount++;
				unsupportedTextProperties += histories[row]!;
				missingGatherableText += missing[row]!;
				diagnosticCount += missingStarts[row + 1]! - missingStarts[row]!;
				for (let gap = starts[row]!; gap < starts[row + 1]!; gap++)
					if (reasons[gap] === 0) diagnosticCount++;
			}
			const identities = this.packageColumn(shard, "occurrence.identity"),
				keys = this.packageColumn(shard, "occurrence.key");
			for (let row = 0; row < identities.length; row++)
				if (identities[row]! < 2 && keys[row] !== 0) resolvedOccurrences++;
		}
		const textOccurrences = this.column("query.raw.members").length;
		return {
			status:
				partialPackages || failedPackages ? ("partial" as const) : ("complete" as const),
			diagnosticCount,
			notGatherablePackages,
			coverage: {
				discoveredPackages,
				inspectedPackages,
				partialPackages,
				failedPackages,
				textUnits: this.column("query.raw.representative").length,
				textOccurrences,
				resolvedOccurrences,
				unresolvedOccurrences: textOccurrences - resolvedOccurrences,
				unsupportedTextProperties,
				...(missingGatherableText > 0 ? { missingGatherableText } : undefined)
			}
		};
	}
	/** Explicit bulk export includes lossless package metadata, without decoding occurrence text. */
	metadataReport() {
		const diagnosticCounts: MutableDiagnosticCounts = {
			package_inspection_failed: 0,
			package_partially_decoded: 0,
			unsupported_text_history: 0
		};
		const counts: MutablePackageCounts = { complete: 0, partial: 0, failed: 0 };
		const starts = new Uint32Array(this.joined.meta.packageNames.length + 1);
		for (let shard = 0; shard + 1 < starts.length; shard++)
			starts[shard + 1] = starts[shard]! + this.packageColumn(shard, "package.status").length;
		const locate = (global: number) => {
			let low = 0,
				high = starts.length - 2;
			while (low < high) {
				const mid = (low + high + 1) >>> 1;
				if (starts[mid]! <= global) low = mid;
				else high = mid - 1;
			}
			return { shard: low, row: global - starts[low]! };
		};
		const state = (shard: number, row: number) => {
			const status = this.packageColumn(shard, "package.status")[row]!;
			return status === 2
				? "not_gatherable"
				: status === 3
					? "failed"
					: status === 1
						? "partial"
						: "complete";
		};
		const order = this.column("query.package.order");
		for (const global of order) {
			const { shard, row } = locate(global),
				status = state(shard, row);
			if (status === "not_gatherable") {
				counts.not_gatherable = (counts.not_gatherable ?? 0) + 1;
				diagnosticCounts.package_not_gatherable =
					(diagnosticCounts.package_not_gatherable ?? 0) + 1;
			} else counts[status]++;
			if (status === "failed") diagnosticCounts.package_inspection_failed++;
			if (status !== "partial") continue;
			diagnosticCounts.package_partially_decoded++;
			const gaps = this.packageColumn(shard, "package.gap_start"),
				reasons = this.packageColumn(shard, "gap.reason"),
				missing = this.packageColumn(shard, "package.missing_start");
			for (let gap = gaps[row]!; gap < gaps[row + 1]!; gap++)
				if (reasons[gap] === 0) diagnosticCounts.unsupported_text_history++;
			if (missing[row + 1]! > missing[row]!)
				diagnosticCounts.gatherable_text_not_decoded =
					(diagnosticCounts.gatherable_text_not_decoded ?? 0) +
					missing[row + 1]! -
					missing[row]!;
		}
		const path = (shard: number, row: number) =>
			relative(
				this.joined.meta.input.projectRoot,
				resolve(
					this.joined.meta.input.projectRoot,
					this.strings([this.packageColumn(shard, "package.path")[row]!])[0]!
				)
			);
		const packages: TextPackageCoverageSummary["packages"][number][] = [];
		const diagnostics: TextCorpusDiagnosticSummary["diagnostics"][number][] = [];
		for (const excluded of [false, true])
			for (const global of order) {
				if (packages.length >= MAX_CORPUS_REPORT_ITEMS) break;
				const { shard, row } = locate(global),
					status = state(shard, row);
				if (status !== "complete" && (status === "not_gatherable") === excluded)
					packages.push({ packageFile: path(shard, row), status });
			}
		for (const wanted of ["failed", "partial", "not_gatherable"] as const)
			for (const global of order) {
				if (diagnostics.length >= MAX_CORPUS_REPORT_ITEMS) break;
				const { shard, row } = locate(global);
				if (state(shard, row) !== wanted) continue;
				const packageFile = path(shard, row);
				if (wanted === "not_gatherable")
					diagnostics.push({
						code: "package_not_gatherable",
						packageFile,
						message:
							"Excluded because Unreal does not gather this package. Its text payload was not inspected."
					});
				else if (wanted === "failed") {
					const error = Schema.decodeUnknownSync(
						Schema.fromJsonString(SavedAssetPackageTextEvent.members[2])
					)(this.strings([this.packageColumn(shard, "package.error")[row]!])[0]!);
					diagnostics.push(
						...textCorpusFromExtractionEvents({
							projectRoot: this.joined.meta.input.projectRoot,
							events: [
								{
									...error,
									path: resolve(this.joined.meta.input.projectRoot, packageFile)
								}
							]
						}).diagnostics.slice(0, MAX_CORPUS_REPORT_ITEMS - diagnostics.length)
					);
				} else
					diagnostics.push(
						...textCorpusFromExtractionEvents({
							projectRoot: this.joined.meta.input.projectRoot,
							events: [
								this.packageRecord(
									shard,
									row,
									resolve(this.joined.meta.input.projectRoot, packageFile)
								)
							]
						}).diagnostics.slice(0, MAX_CORPUS_REPORT_ITEMS - diagnostics.length)
					);
			}
		const diagnosticCount = Object.values(diagnosticCounts).reduce(
			(sum, count) => sum + count,
			0
		);
		return {
			diagnostics,
			diagnosticCounts,
			diagnosticCount,
			diagnosticsOmitted: diagnosticCount - diagnostics.length,
			packageCoverage: {
				counts,
				packages,
				omitted:
					counts.partial + counts.failed + (counts.not_gatherable ?? 0) - packages.length
			}
		};
	}
	/** Explicit bulk export includes lossless package metadata, without decoding occurrence text. */
	exportMetadata() {
		const joined = this.joined;
		const records = runJoinedQuery(
			Effect.gen(function* () {
				const result: Effect.Success<ReturnType<typeof decodePackageTextColumns>> = [];
				for (const name of joined.meta.packageNames) {
					const layer = yield* joined.reader.layer(name);
					const packageCount = (yield* u32(layer, "package.path")).length;
					result.push(
						...(yield* decodePackageTextColumns({
							...layer,
							section: (field) =>
								field.startsWith("occurrence.")
									? Effect.succeed(new Uint32Array())
									: field === "package.occurrence_start"
										? Effect.succeed(new Uint32Array(packageCount + 1))
										: layer.section(field)
						}))
					);
				}
				return result;
			}).pipe(Effect.scoped)
		);
		records.sort((left, right) =>
			comparePackageTextPathBytes(encodeWtf8(left.path), encodeWtf8(right.path))
		);
		const projectRoot = this.joined.meta.input.projectRoot;
		const metadata = textCorpusFromExtractionEvents({
			projectRoot,
			discoveredPackages: records.length,
			events: records.flatMap((record) =>
				record.evidence.event === "not_gatherable"
					? []
					: [{ ...record.evidence, path: resolve(projectRoot, record.path) }]
			)
		});
		return textCorpusWithExcludedPackages(
			metadata,
			records
				.filter((record) => record.evidence.event === "not_gatherable")
				.map((record) => relative(projectRoot, resolve(projectRoot, record.path)))
		);
	}
	/** Diagnostics hydrate only the packages represented by a focused unit. */
	diagnostics(members: Uint32Array) {
		const result = new Map<
			string,
			ReturnType<typeof textCorpusFromExtractionEvents>["diagnostics"][number]
		>();
		const seen = new Set<string>();
		for (const global of members) {
			let shard = 0;
			while (this.joined.meta.packageStarts[shard + 1]! <= global) shard++;
			const row = global - this.joined.meta.packageStarts[shard]!;
			const starts = this.packageColumn(shard, "package.occurrence_start");
			let packageRow = 0;
			while (starts[packageRow + 1]! <= row) packageRow++;
			const key = `${shard}:${packageRow}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const projectRoot = this.joined.meta.input.projectRoot;
			const path = this.strings([this.packageColumn(shard, "package.path")[packageRow]!])[0]!;
			const corpus = textCorpusFromExtractionEvents({
				projectRoot,
				events: [this.packageRecord(shard, packageRow, resolve(projectRoot, path))]
			});
			for (const diagnostic of corpus.diagnostics)
				result.set(
					`${diagnostic.code}:${diagnostic.packageFile}:${diagnostic.objectPath ?? ""}:${diagnostic.propertyPath ?? ""}`,
					diagnostic
				);
		}
		return [...result.values()];
	}
}
