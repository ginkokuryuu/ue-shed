import { encodeWtf8 } from "./wtf8.js";
import {
	absent,
	unitId,
	occurrenceLocation,
	packagePath,
	type JoinPackages
} from "./joined-target-input.js";
import {
	StringArena,
	packedStringReader,
	sortPackedStringsByLocale
} from "./shared-string-codec.js";
import { snapshotCheck } from "./snapshot-format.js";
import { textAudienceBit } from "./text-audience.js";
import { OCCURRENCE_COPY_DIFFERS } from "./package-text-columns.js";
import { longestSource } from "./source-metrics.js";
import { DuplicateSources, duplicateOccurrencePlace } from "./duplicate-sources.js";

/** Canonical place IDs keep source overlays numeric without retaining decoded occurrences. */
export function joinedDuplicateSources(
	packages: JoinPackages,
	line: Record<string, Uint32Array>,
	order: Uint32Array,
	empty: number
) {
	const c = packages.occurrence;
	const places = new Uint32Array(order.length);
	const placeIds = new Map<string, number>();
	const packageFiles = new Map<number, string>();
	const identities = new Uint32Array(order.length);
	const sources = new DuplicateSources<number, number, number>();
	for (let row = 0; row < line.source!.length; row++)
		for (let position = line.occ_start![row]!; position < line.occ_end![row]!; position++) {
			const member = order[position]!;
			const packageRow = packages.packageRow[member]!;
			let packageFile = packageFiles.get(packageRow);
			if (packageFile === undefined) {
				packageFile = packagePath(packages, packageRow);
				packageFiles.set(packageRow, packageFile);
			}
			const key = duplicateOccurrencePlace({
				packageFile,
				location: occurrenceLocation(packages, member)
			});
			let place = placeIds.get(key);
			if (place === undefined) {
				place = placeIds.size;
				placeIds.set(key, place);
			}
			places[member] = place;
			identities[member] = row;
			if (c.identity[member] === 0 && c.key[member] !== empty)
				sources.add(c.source[member]!, row, place);
		}
	const duplicate = new Uint8Array(order.length);
	for (const member of order)
		if (c.identity[member] === 0 && c.key[member] !== empty)
			duplicate[member] = Number(
				sources.hasOther(c.source[member]!, identities[member]!, places[member]!)
			);
	return { duplicate, places };
}

/** Numeric query entries retain raw-unit predicates and each gathered occurrence slice. */
export function joinedQueryColumns(input: {
	readonly packages: JoinPackages;
	readonly line: Record<string, Uint32Array>;
	readonly order: Uint32Array;
	readonly rawOrder: Uint32Array;
	readonly representative: Uint32Array;
	readonly next: Uint32Array;
	readonly packageFiles: Uint32Array;
	readonly empty: number;
}) {
	const { packages, line, order, rawOrder, representative, next, packageFiles, empty } = input;
	const c = packages.occurrence,
		strings = packages.strings;
	const occurrenceLine = new Uint32Array(order.length);
	const groupFlags = new Uint8Array(line.source!.length);
	const { duplicate, places } = joinedDuplicateSources(packages, line, order, empty);
	for (let row = 0; row < line.source!.length; row++) {
		const sources = new Set<number>();
		for (let position = line.occ_start![row]!; position < line.occ_end![row]!; position++) {
			const member = order[position]!;
			occurrenceLine[member] = row;
			if (c.identity[member] === 1) continue;
			const source = c.source[member]!;
			sources.add(source);
		}
		groupFlags[row] =
			(line.occ_end![row]! - line.occ_start![row]! > 1 ? 1 : 0) | (sources.size > 1 ? 16 : 0);
	}
	let rawCount = 0;
	for (const member of rawOrder) if (representative[member] === member) rawCount++;
	const rawIndex = new Uint32Array(order.length);
	const rawRepresentatives = new Uint32Array(rawCount);
	let rawRow = 0;
	for (const member of rawOrder)
		if (representative[member] === member) {
			rawRepresentatives[rawRow] = member;
			rawIndex[member] = rawRow++;
		}
	let sliceCount = 0;
	const lineStarts = new Uint32Array(line.source!.length + 1);
	for (let row = 0; row < line.source!.length; row++) {
		lineStarts[row] = sliceCount;
		const units = new Set<number>();
		for (let position = line.occ_start![row]!; position < line.occ_end![row]!; position++)
			units.add(representative[order[position]!]!);
		sliceCount += units.size;
	}
	lineStarts[line.source!.length] = sliceCount;
	const fields = [
		"representative",
		"identity",
		"namespace",
		"raw",
		"line",
		"member_start",
		"member_end",
		"source_start",
		"source_end",
		"file_start",
		"file_end",
		"signals",
		"origins",
		"editing",
		"notes",
		// Mask of the members' audiences (textAudienceBit); textAudienceOfMask rolls it up.
		"audience",
		"characters",
		"words",
		"visible"
	];
	const result: Record<string, Uint32Array> = {};
	const raw = Object.fromEntries(fields.map((name) => [name, new Uint32Array(rawCount)]));
	const slice = Object.fromEntries(fields.map((name) => [name, new Uint32Array(sliceCount)]));
	function vector(capacity: number) {
		let values = new Uint32Array(Math.max(1, capacity)),
			count = 0;
		return {
			get count() {
				return count;
			},
			add(value: number) {
				if (count === values.length) {
					const expanded = new Uint32Array(values.length * 2);
					expanded.set(values);
					values = expanded;
				}
				values[count++] = value;
			},
			finish: () => values.subarray(0, count)
		};
	}
	const rawMembers = vector(order.length),
		sliceMembers = vector(order.length);
	const rawSources = vector(rawCount),
		sliceSources = vector(sliceCount);
	const rawFiles = vector(rawCount),
		sliceFiles = vector(sliceCount);
	const ids = new StringArena(256 * 1024, rawCount);
	const unitName = (member: number) =>
		unitId(
			packages,
			member,
			strings.string(c.namespace[member]!),
			strings.string(c.key[member]!)
		);
	for (const member of rawRepresentatives) ids.add(Buffer.from(encodeWtf8(unitName(member))));
	const packedIds = ids.finish();
	const id = packedStringReader(packedIds);
	function add(
		columns: Record<string, Uint32Array>,
		row: number,
		first: number,
		gathered: number,
		members: ReturnType<typeof vector>,
		sources: ReturnType<typeof vector>,
		files: ReturnType<typeof vector>
	) {
		columns.representative![row] = first;
		columns.identity![row] = c.identity[first]!;
		columns.namespace![row] = c.namespace[first]!;
		columns.raw![row] = rawIndex[first]!;
		columns.line![row] = gathered;
		columns.member_start![row] = members.count;
		columns.source_start![row] = sources.count;
		columns.file_start![row] = files.count;
		const values = new Set<number>(),
			paths = new Set<number>();
		let flags = 0,
			origins = 0,
			audience = 0,
			editing = 0,
			notes = 0,
			characters = 0,
			words = 0,
			visible = false;
		for (let member = first; member !== absent; member = next[member]!) {
			// Same slice rule as localizationLineUnits, including contexts of references.
			if (
				gathered !== absent &&
				c.identity[member] === 0 &&
				c.key[member] !== empty &&
				occurrenceLine[member] !== gathered
			)
				continue;
			members.add(member);
			values.add(c.source[member]!);
			paths.add(packageFiles[packages.packageRow[member]!]!);
			flags |= groupFlags[gathered === absent ? occurrenceLine[member]! : gathered]!;
			if (duplicate[member]) flags |= 2;
			origins |= 1 << (c.location[member] === 2 ? 0 : c.location[member] === 1 ? 1 : 2);
			editing |= c.editable[member] ? 1 : 2;
			audience |= textAudienceBit(c.audience[member]!);
			// A Blueprint edited since it compiled: the game shows a compiled copy's text.
			if (c.copies[member]! & OCCURRENCE_COPY_DIFFERS) flags |= 64;
			if (strings.string(c.notes[member]!).trim() !== "") notes = 1;
		}
		const decoded = [...values].map((source) => ({ source, value: strings.string(source) }));
		decoded.sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
		for (const { source, value } of decoded) {
			sources.add(source);
			if (value.trim() !== "") {
				visible = true;
			}
		}
		const longest = longestSource(decoded.map(({ value }) => value));
		characters = longest.length;
		words = longest.trim() === "" ? 0 : longest.trim().split(/\s+/u).length;
		if (characters >= 40) flags |= 4;
		if (c.identity[first]! >= 2 || c.key[first] === empty) flags |= 8;
		if (editing === 2) flags |= 32;
		for (const file of paths) files.add(file);
		columns.member_end![row] = members.count;
		columns.source_end![row] = sources.count;
		columns.file_end![row] = files.count;
		columns.signals![row] = flags;
		columns.origins![row] = origins;
		columns.editing![row] = editing;
		columns.audience![row] = audience;
		columns.notes![row] = notes;
		columns.characters![row] = characters;
		columns.words![row] = words;
		columns.visible![row] = Number(visible);
	}
	for (let row = 0; row < rawCount; row++)
		add(raw, row, rawRepresentatives[row]!, absent, rawMembers, rawSources, rawFiles);
	const rawOrderColumn = Uint32Array.from({ length: rawCount }, (_, row) => row);
	let ordered = true;
	for (let row = 1; row < rawCount; row++)
		if (id(row - 1).localeCompare(id(row)) > 0) {
			ordered = false;
			break;
		}
	if (!ordered) rawOrderColumn.set(sortPackedStringsByLocale(packedIds, rawOrderColumn));
	let sliceRow = 0;
	for (let row = 0; row < line.source!.length; row++) {
		const units = new Set<number>();
		for (let position = line.occ_start![row]!; position < line.occ_end![row]!; position++)
			units.add(representative[order[position]!]!);
		const selected = [...units].sort((a, b) => {
			const left = id(rawIndex[a]!),
				right = id(rawIndex[b]!);
			return left < right ? -1 : left > right ? 1 : 0;
		});
		for (const first of selected)
			add(slice, sliceRow++, first, row, sliceMembers, sliceSources, sliceFiles);
	}
	for (const [prefix, columns, members, sources, files] of [
		["raw", raw, rawMembers, rawSources, rawFiles],
		["slice", slice, sliceMembers, sliceSources, sliceFiles]
	] as const) {
		for (const [field, values] of Object.entries(columns))
			result[`query.${prefix}.${field}`] = values;
		result[`query.${prefix}.members`] = members.finish();
		result[`query.${prefix}.sources`] = sources.finish();
		result[`query.${prefix}.files`] = files.finish();
	}
	result["query.raw.order"] = rawOrderColumn;
	const idBytes = new Uint32Array(Math.ceil(packedIds.bytes.length / 4));
	snapshotCheck(
		packedIds.bytes.length <= 0xffffffff,
		"query.ids",
		"Unit ID bytes exceed u32 range"
	);
	new Uint8Array(idBytes.buffer).set(packedIds.bytes);
	result["query.raw.id_utf8"] = idBytes;
	result["query.raw.id_starts"] = Uint32Array.from(packedIds.offsets);
	result["query.line.starts"] = lineStarts;
	result["query.occurrence.places"] = places;
	result["query.occurrence.sources"] = c.source;
	return result;
}
