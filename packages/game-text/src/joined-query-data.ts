import { relative, resolve } from "node:path";
import { Cache, Effect } from "effect";
import { textOccurrenceFromExtraction, textCorpusFromExtractionEvents } from "./corpus.js";
import { emptyPackageTextRecord } from "./package-text-record.js";
import { packageTextGapReasons, decodePackageTextColumns } from "./package-text-columns.js";
import { textCorpusWithExcludedPackages } from "./package-text-candidates.js";
import { comparePackageTextPathBytes } from "./package-text-order.js";
import { TextUnitId } from "./identifiers.js";
import { hydrateJoinedTarget, type JoinedTargetReader } from "./joined-target-reader.js";
import { synchronousJoinedTarget } from "./joined-query-reader.js";
import { runJoinedQuery } from "./joined-query-node.js";
import { snapshotCheck } from "./snapshot-format.js";
import { u32 } from "./joined-target-input.js";
import type { TextUnit, TextOccurrence, TextUnitSearchResult, TextReviewSignal } from "./schema.js";

export const querySignals = [
	"shared",
	"duplicate_source",
	"long",
	"unresolved",
	"conflicting",
	"evidence_only"
] as const satisfies readonly TextReviewSignal[];

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

/** Column and bounded row access for the synchronous public API. No corpus is materialized. */
export class JoinedQueryData {
	readonly joined: JoinedTargetReader;
	private readonly columns = new Map<string, Uint32Array>();
	private readonly displayedLines: ReturnType<typeof displayedLines>;
	constructor(joined: JoinedTargetReader) {
		this.joined = synchronousJoinedTarget(joined);
		this.displayedLines = displayedLines(this.joined);
	}
	column(name: string) {
		let value = this.columns.get(name);
		if (!value) {
			value = runJoinedQuery(u32(this.joined.layer, name));
			this.columns.set(name, value);
		}
		return value;
	}
	strings(ids: readonly number[]) {
		return this.joined.reader.stringsSync!(ids);
	}
	packageColumn(shard: number, field: string) {
		const key = `${shard}:${field}`;
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
			Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
				"utf8",
				starts[row],
				starts[row + 1]
			)
		);
	}
	lineId(row: number) {
		const starts = this.column("query.line.id_starts"),
			bytes = this.column("query.line.id_utf8");
		return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
			"utf8",
			starts[row],
			starts[row + 1]
		);
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
	metadata() {
		let discoveredPackages = 0,
			inspectedPackages = 0,
			partialPackages = 0,
			failedPackages = 0,
			unsupportedTextProperties = 0,
			diagnosticCount = 0,
			notGatherablePackages = 0,
			resolvedOccurrences = 0;
		for (let shard = 0; shard < this.joined.meta.packageNames.length; shard++) {
			const statuses = this.packageColumn(shard, "package.status");
			const gaps = packageTextGapReasons.map((_, index) =>
				this.packageColumn(shard, `package.gap${index}`)
			);
			const starts = this.packageColumn(shard, "package.gap_start");
			const reasons = this.packageColumn(shard, "gap.reason");
			discoveredPackages += statuses.length;
			for (let row = 0; row < statuses.length; row++) {
				const total = gaps.reduce((sum, column) => sum + column[row]!, 0);
				unsupportedTextProperties += total;
				if (statuses[row]! < 2) inspectedPackages++;
				if (statuses[row] === 3) {
					failedPackages++;
					diagnosticCount++;
				}
				if (statuses[row] === 2) {
					notGatherablePackages++;
					diagnosticCount++;
				}
				if (statuses[row] === 1 || total > 0) {
					partialPackages++;
					diagnosticCount++;
				}
				if (total > 0)
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
				partialPackages || failedPackages || unsupportedTextProperties
					? ("partial" as const)
					: ("complete" as const),
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
				unsupportedTextProperties
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
			comparePackageTextPathBytes(Buffer.from(left.path), Buffer.from(right.path))
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
			const record = emptyPackageTextRecord(resolve(projectRoot, path));
			const gapCounts = { ...record.gapCounts };
			for (let index = 0; index < packageTextGapReasons.length; index++)
				gapCounts[packageTextGapReasons[index]!] = this.packageColumn(
					shard,
					`package.gap${index}`
				)[packageRow]!;
			const gapStarts = this.packageColumn(shard, "package.gap_start");
			const gapSamples = [];
			for (let gap = gapStarts[packageRow]!; gap < gapStarts[packageRow + 1]!; gap++) {
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
			const corpus = textCorpusFromExtractionEvents({
				projectRoot,
				events: [
					{
						...record,
						status:
							this.packageColumn(shard, "package.status")[packageRow] === 1
								? "partial"
								: "complete",
						decodeErrors: this.packageColumn(shard, "package.decode_errors")[
							packageRow
						]!,
						gapCounts,
						gapSamples
					}
				]
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
