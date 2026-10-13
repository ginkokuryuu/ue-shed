import { openSync, closeSync, readSync, writeSync } from "node:fs";
import { join } from "node:path";
import { decodeStringBlock, snapshotCheck } from "./snapshot-format.js";
import { StringArena, sortBytes, stringBytes } from "./shared-string-codec.js";
import type { SnapshotSource } from "./snapshot-file.js";
import type { SharedStringFiles } from "./shared-string-file.js";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { HostSliceClock, nextMacrotask } from "./host-slices.js";
import { Schema } from "effect";

const Natural = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const FileReuse = Schema.Record(
	Schema.String,
	Schema.Array(
		Schema.Struct({
			start: Natural,
			count: Natural,
			hash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u))
		})
	).pipe(Schema.mutable, Schema.mutableKey)
);
export const PreparedColdStrings = Schema.Struct({
	runs: Schema.Array(Schema.String),
	domains: Schema.Array(Schema.Struct({ name: Schema.String, count: Natural })),
	hashes: FileReuse
});
export type PreparedColdStrings = typeof PreparedColdStrings.Type;

/** Only temporary sort files use this framing. Persisted segments retain snapshot CRCs. */
class RunWriter {
	private readonly handle: number;
	private readonly buffer = Buffer.allocUnsafe(1024 * 1024);
	private position = 0;
	constructor(path: string) {
		this.handle = openSync(path, "wx");
	}
	bytes(bytes: Uint8Array) {
		for (let start = 0; start < bytes.length; ) {
			const count = Math.min(bytes.length - start, this.buffer.length - this.position);
			this.buffer.set(bytes.subarray(start, start + count), this.position);
			this.position += count;
			start += count;
			if (this.position === this.buffer.length) this.flush();
		}
	}
	u32(value: number) {
		if (this.position + 4 > this.buffer.length) this.flush();
		this.buffer.writeUInt32LE(value, this.position);
		this.position += 4;
	}
	private flush() {
		for (let start = 0; start < this.position; ) {
			const count = writeSync(this.handle, this.buffer, start, this.position - start);
			snapshotCheck(count > 0, "sort", "Short temporary write");
			start += count;
		}
		this.position = 0;
	}
	close() {
		try {
			this.flush();
		} finally {
			closeSync(this.handle);
		}
	}
}
class RunReader {
	private readonly handle: number;
	private readonly buffer: Buffer;
	private position = 0;
	private end = 0;
	constructor(path: string, bufferBytes = 1024 * 1024) {
		this.handle = openSync(path, "r");
		this.buffer = Buffer.allocUnsafe(bufferBytes);
	}
	private fill() {
		this.end = readSync(this.handle, this.buffer, 0, this.buffer.length, null);
		this.position = 0;
		return this.end > 0;
	}
	u32(optional = false): number | undefined {
		if (this.position === this.end && !this.fill()) {
			snapshotCheck(optional, "sort", "Truncated temporary integer");
			return undefined;
		}
		if (this.position + 4 <= this.end) {
			const value = this.buffer.readUInt32LE(this.position);
			this.position += 4;
			return value;
		}
		return this.bytes(4).readUInt32LE();
	}
	bytes(length: number) {
		snapshotCheck(length <= 1024 * 1024, "sort", "Temporary key exceeds cap");
		const result = Buffer.allocUnsafe(length);
		for (let start = 0; start < length; ) {
			if (this.position === this.end)
				snapshotCheck(this.fill(), "sort", "Truncated temporary key");
			const count = Math.min(length - start, this.end - this.position);
			this.buffer.copy(result, start, this.position, this.position + count);
			this.position += count;
			start += count;
		}
		return result;
	}
	close() {
		closeSync(this.handle);
	}
}
export function storageStringDomain(name: string, domain: string) {
	const culture = name
		.replaceAll("\\", "/")
		.match(/\/([A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*)\/[^/]+\.(?:archive|po)$/u)?.[1];
	return domain === "translation" && culture && culture.length <= 16
		? `culture.${culture}`
		: domain;
}
export interface ColdLayerSource {
	readonly name: string;
	readonly key: string;
	readonly source: SnapshotSource;
	readonly preparedStrings?: PreparedColdStrings;
	/** Immutable local snapshot prepared under the cold importer's scope. */
	readonly stagedFile?: string;
}

/** Workers sort bounded local runs while their parsed columns are still available.
 * Occurrences and owners stay local; publication assigns deterministic global IDs.
 */
export async function prepareColdStringRuns(
	source: SnapshotSource,
	staging: string,
	runBytes = 16 * 1024 ** 2
): Promise<PreparedColdStrings> {
	const domains: { name: string; count: number }[] = [];
	for (const column of source.columns)
		if (column.kind === "strings" && !domains.some((value) => value.name === column.domain))
			domains.push({ name: column.domain!, count: column.stringCount! });
	const starts: number[] = [];
	let total = 0;
	for (const domain of domains) {
		starts.push(total);
		total += domain.count;
	}
	snapshotCheck(total < 0xffffffff, "sort", "Cold occurrence count exceeds u32");
	const capacity = Math.max(1, Math.floor(runBytes / 12));
	const occurrences = new Uint32Array(capacity),
		owners = new Uint16Array(capacity),
		positions = new Uint32Array(domains.length);
	let arena = new StringArena(runBytes),
		rows = 0,
		bytes = 0;
	const runs: string[] = [],
		hashes: typeof FileReuse.Type = {};
	const reusable = source.columns.some((column) => column.name === "file.meta");
	const flush = () => {
		if (!rows) return;
		const values = arena.finish(),
			order = sortBytes(values),
			path = join(staging, `strings-${runs.length}.run`),
			writer = new RunWriter(path);
		try {
			for (const row of order) {
				const key = stringBytes(values, row);
				writer.u32(key.length);
				writer.u32(occurrences[row]!);
				writer.u32(owners[row]!);
				writer.bytes(key);
			}
		} finally {
			writer.close();
		}
		runs.push(path);
		arena = new StringArena(runBytes);
		rows = 0;
		bytes = 0;
	};
	for (const column of source.columns) {
		if (column.kind !== "strings") continue;
		const data = await column.load();
		snapshotCheck(data instanceof Uint8Array, column.name, "Invalid cold string block");
		const block = decodeStringBlock(data),
			owner = domains.findIndex((value) => value.name === column.domain);
		if (reusable) {
			const list = hashes[column.domain!] ?? [];
			list.push({
				start: positions[owner]!,
				count: block.count,
				hash: createHash("sha256").update(data).digest("hex")
			});
			hashes[column.domain!] = list;
		}
		for (let row = 0; row < block.count; row++) {
			const key = block.bytes(row);
			if (bytes + key.length + 12 > runBytes || rows === capacity) flush();
			arena.add(key);
			occurrences[rows] = starts[owner]! + positions[owner]!++;
			owners[rows++] = owner;
			bytes += key.length + 12;
		}
	}
	flush();
	for (let owner = 0; owner < domains.length; owner++)
		snapshotCheck(
			positions[owner] === domains[owner]!.count,
			"sort",
			"Cold domain count differs"
		);
	return { runs, domains, hashes };
}

/** Global deduplication in 64 MiB byte runs. Empty stores need no probes. Existing stores
 * resolve the sorted domain keys once, preserving shared IDs without another sort.
 */
export async function sortColdStrings(
	entries: readonly ColdLayerSource[],
	files: SharedStringFiles,
	staging: string,
	runBytes = 64 * 1024 ** 2
) {
	const started = performance.now();
	// The run reads and merge are synchronous file I/O; slices keep the host responsive.
	const clock = new HostSliceClock();
	const domains: string[] = [];
	const hashes: (typeof FileReuse.Type)[] = entries.map(() => ({}));
	const ranges = entries.map((entry) => {
		const result = new Map<string, { start: number; count: number; owner: number }>();
		for (const column of entry.source.columns) {
			if (column.kind !== "strings" || result.has(column.domain!)) continue;
			const domain = storageStringDomain(entry.name, column.domain!);
			if (!domains.includes(domain)) domains.push(domain);
			result.set(column.domain!, {
				start: 0,
				count: column.stringCount!,
				owner: domains.indexOf(domain)
			});
		}
		return result;
	});
	let total = 0;
	for (const range of ranges)
		for (const value of range.values()) {
			value.start = total;
			total += value.count;
		}
	snapshotCheck(total < 0xffffffff, "sort", "Cold occurrence count exceeds u32");
	const mapping = new Uint32Array(total);
	const capacity = Math.max(1, Math.floor(runBytes / 12));
	let arena = new StringArena(runBytes);
	const occurrence = new Uint32Array(capacity),
		owners = new Uint16Array(capacity);
	let bytes = 0,
		rows = 0;
	const runs: { path: string; offset: number; owners?: Uint16Array }[] = [];
	const flush = () => {
		if (!rows) return;
		const values = arena.finish(),
			order = sortBytes(values);
		const path = join(staging, `run-${runs.length}`),
			writer = new RunWriter(path);
		try {
			for (const id of order) {
				const key = stringBytes(values, id);
				writer.u32(key.length);
				writer.u32(occurrence[id]!);
				writer.u32(owners[id]!);
				writer.bytes(key);
			}
		} finally {
			writer.close();
		}
		runs.push({ path, offset: 0 });
		arena = new StringArena(runBytes);
		rows = 0;
		bytes = 0;
	};
	for (let file = 0; file < entries.length; file++) {
		const prepared = entries[file]!.preparedStrings;
		if (prepared) {
			const range = ranges[file]!,
				owners = new Uint16Array(prepared.domains.length);
			snapshotCheck(
				prepared.domains.length === range.size,
				"sort",
				"Prepared domain count differs"
			);
			let position = 0;
			const offset = [...range.values()][0]?.start ?? 0;
			for (let owner = 0; owner < prepared.domains.length; owner++) {
				const domain = prepared.domains[owner]!,
					value = range.get(domain.name);
				snapshotCheck(
					value !== undefined &&
						value.count === domain.count &&
						value.start === offset + position,
					"sort",
					"Prepared domain range differs"
				);
				owners[owner] = value.owner;
				position += domain.count;
			}
			hashes[file] = prepared.hashes;
			for (const path of prepared.runs) runs.push({ path, offset, owners });
			continue;
		}
		const positions = new Map<string, number>();
		const reusable = entries[file]!.source.columns.some((entry) => entry.name === "file.meta");
		for (const column of entries[file]!.source.columns) {
			if (column.kind !== "strings") continue;
			const data = await column.load();
			snapshotCheck(data instanceof Uint8Array, column.name, "Invalid cold string block");
			const block = decodeStringBlock(data),
				domain = column.domain!,
				range = ranges[file]!.get(domain)!;
			let position = positions.get(domain) ?? 0;
			if (reusable) {
				const blocks = hashes[file]![domain] ?? [];
				blocks.push({
					start: position,
					count: block.count,
					hash: createHash("sha256").update(data).digest("hex")
				});
				hashes[file]![domain] = blocks;
			}
			for (let row = 0; row < block.count; row++) {
				const key = block.bytes(row);
				if (bytes + key.length + 12 > runBytes) flush();
				arena.add(key);
				occurrence[rows] = range.start + position++;
				owners[rows++] = range.owner;
				bytes += key.length + 12;
				if (clock.step()) await nextMacrotask();
			}
			positions.set(domain, position);
		}
		for (const [domain, range] of ranges[file]!)
			snapshotCheck(
				positions.get(domain) === range.count,
				"sort",
				"Cold domain count differs"
			);
	}
	flush();
	// Drop the final empty arena before the merge.
	arena = new StringArena(0, 0);
	const readers: RunReader[] = [],
		writers: RunWriter[] = [];
	const origins = new Map<RunReader, { offset: number; owners?: Uint16Array }>();
	const counts = new Uint32Array(domains.length),
		rankOwners: Uint16Array[] = [],
		ranks: Uint32Array[] = [];
	const rankChunk = 1024 * 1024;
	let uniqueCount = 0;
	const heap: { reader: RunReader; key: Buffer; occurrence: number; owner: number }[] = [];
	type Head = (typeof heap)[number];
	const next = (reader: RunReader): Head | undefined => {
		const length = reader.u32(true);
		if (length === undefined) return undefined;
		const local = reader.u32()!,
			localOwner = reader.u32()!,
			origin = origins.get(reader)!,
			occurrence = local + origin.offset,
			owner = origin.owners ? origin.owners[localOwner] : localOwner;
		snapshotCheck(
			occurrence < mapping.length && owner !== undefined && owner < domains.length,
			"sort",
			"Prepared key outside domain range"
		);
		return { reader, key: reader.bytes(length), occurrence, owner };
	};
	const compare = (a: Head, b: Head) => Buffer.compare(a.key, b.key) || a.owner - b.owner;
	const push = (head: Head) => {
		let index = heap.length;
		heap.push(head);
		while (index) {
			const parent = (index - 1) >>> 1;
			if (compare(heap[parent]!, head) <= 0) break;
			heap[index] = heap[parent]!;
			index = parent;
		}
		heap[index] = head;
	};
	const pop = () => {
		const first = heap[0]!,
			last = heap.pop()!;
		if (heap.length) {
			let index = 0;
			while (index * 2 + 1 < heap.length) {
				let child = index * 2 + 1;
				if (child + 1 < heap.length && compare(heap[child + 1]!, heap[child]!) < 0) child++;
				if (compare(last, heap[child]!) <= 0) break;
				heap[index] = heap[child]!;
				index = child;
			}
			heap[index] = last;
		}
		return first;
	};
	try {
		for (let domain = 0; domain < domains.length; domain++)
			writers.push(new RunWriter(join(staging, `domain-${domain}`)));
		const bufferBytes = Math.max(
			16 * 1024,
			Math.min(1024 * 1024, Math.floor((16 * 1024 ** 2) / Math.max(1, runs.length)))
		);
		for (const run of runs) {
			const reader = new RunReader(run.path, bufferBytes);
			origins.set(reader, run);
			readers.push(reader);
			const head = next(reader);
			if (head) push(head);
		}
		let previous: Buffer | undefined,
			rank = -1,
			owner = 0;
		const finishKey = () => {
			if (!previous) return;
			const chunk = Math.floor(rank / rankChunk),
				local = rank % rankChunk;
			rankOwners[chunk]![local] = owner;
			ranks[chunk]![local] = counts[owner]!++;
			const writer = writers[owner]!;
			writer.u32(previous.length);
			writer.bytes(previous);
		};
		while (heap.length) {
			const head = pop();
			if (!previous || !previous.equals(head.key)) {
				finishKey();
				rank++;
				previous = head.key;
				owner = head.owner;
				const chunk = Math.floor(rank / rankChunk);
				if (!ranks[chunk]) {
					ranks.push(new Uint32Array(rankChunk));
					rankOwners.push(new Uint16Array(rankChunk));
				}
				uniqueCount++;
			} else owner = Math.min(owner, head.owner);
			mapping[head.occurrence] = rank;
			const following = next(head.reader);
			if (following) push(following);
			if (clock.step()) await nextMacrotask();
		}
		finishKey();
	} finally {
		for (const reader of readers) reader.close();
		for (const writer of writers) writer.close();
	}
	files.sortMs += performance.now() - started;
	const bases = new Uint32Array(domains.length);
	const existingStore = files.count > 0;
	const resolved: Uint32Array[] = [];
	for (let owner = 0; owner < domains.length; owner++) {
		bases[owner] = files.count;
		if (!counts[owner]) continue;
		async function* keys() {
			const reader = new RunReader(join(staging, `domain-${owner}`));
			try {
				for (let length = reader.u32(true); length !== undefined; length = reader.u32(true))
					yield { bytes: reader.bytes(length), owner: 0 };
			} finally {
				reader.close();
			}
		}
		if (existingStore) {
			const arena = new StringArena(0, counts[owner]!);
			for await (const key of keys()) {
				arena.add(key.bytes);
				if (clock.step()) await nextMacrotask();
			}
			resolved[owner] = await files.internPacked(
				domains[owner]!,
				arena.finish(),
				undefined,
				true
			);
		} else await files.appendOrdered(domains[owner]!, counts[owner]!, keys());
	}
	for (let rank = 0; rank < uniqueCount; rank++) {
		const chunk = Math.floor(rank / rankChunk),
			local = rank % rankChunk;
		const owner = rankOwners[chunk]![local]!;
		ranks[chunk]![local] = existingStore
			? resolved[owner]![ranks[chunk]![local]!]!
			: ranks[chunk]![local]! + bases[owner]!;
		if (clock.step()) await nextMacrotask();
	}
	for (let id = 0; id < mapping.length; id++) {
		const rank = mapping[id]!;
		mapping[id] = ranks[Math.floor(rank / rankChunk)]![rank % rankChunk]!;
		if (clock.step()) await nextMacrotask();
	}
	const maps = ranges.map(
		(range) =>
			new Map(
				[...range].map(([domain, value]) => [
					domain,
					mapping.subarray(value.start, value.start + value.count)
				])
			)
	);
	return maps.map((mapping, row) => ({ maps: mapping, hashes: hashes[row]! }));
}
