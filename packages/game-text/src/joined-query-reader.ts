import { Effect } from "effect";
import { snapshotCheck, snapshotFailure, SnapshotFormatError } from "./snapshot-format.js";
import { SnapshotStoreError } from "./snapshot-store.js";
import type { JoinedTargetReader } from "./joined-target-reader.js";
import { runJoinedQuery } from "./joined-query-node.js";

const read = <A>(operation: string, run: () => A) =>
	Effect.try({
		try: run,
		catch: (cause) =>
			cause instanceof SnapshotFormatError || cause instanceof SnapshotStoreError
				? cause
				: snapshotFailure(operation, String(cause))
	});

/** The existing synchronous query API uses the same pinned handles, codecs and column cache.
 * No Effect runtime crosses an asynchronous boundary during a page or focus request.
 */
export function synchronousJoinedTarget(joined: JoinedTargetReader): JoinedTargetReader {
	const layerSync = joined.reader.layerSync,
		stringsSync = joined.reader.stringsSync;
	snapshotCheck(
		layerSync !== undefined && stringsSync !== undefined,
		"query.reader",
		"The index adapter does not support synchronous queries"
	);
	const layer = (name: string) =>
		read("query.layer", () => {
			const opened = layerSync(name);
			return {
				directory: opened.directory,
				section: (field: string) => read(field, () => opened.section(field)),
				strings: (_domain: string, ids: readonly number[]) =>
					read("query.strings", () => stringsSync(ids))
			};
		});
	const raw = layerSync("joined"),
		base = joined.meta.base ? layerSync(joined.meta.base) : raw;
	const patched = new Map<string, Uint32Array>();
	const section = (name: string) =>
		read(name, () => {
			if (name === "join.meta") return raw.section(name);
			const patch = joined.meta.patches?.[name];
			if (!patch) return base.section(joined.meta.aliases[name] ?? name);
			let values = patched.get(name);
			if (values) return values;
			const original = base.section(joined.meta.aliases[name] ?? name),
				rows = raw.section(joined.meta.patchRows?.[name] ?? "patch.rows"),
				replacements = raw.section(patch);
			snapshotCheck(
				original instanceof Uint32Array &&
					rows instanceof Uint32Array &&
					replacements instanceof Uint32Array,
				name,
				"Invalid patch column kind"
			);
			snapshotCheck(rows.length === replacements.length, patch, "Patch lengths differ");
			values = original.slice();
			for (let row = 0; row < rows.length; row++) {
				snapshotCheck(
					rows[row]! < values.length && (row === 0 || rows[row]! > rows[row - 1]!),
					patch,
					"Invalid patch row"
				);
				values[rows[row]!] = replacements[row]!;
			}
			patched.set(name, values);
			return values;
		});
	return {
		...joined,
		reader: {
			...joined.reader,
			layer,
			strings: (ids) => read("query.strings", () => stringsSync(ids))
		},
		layer: { ...joined.layer, section },
		rawLayer: runJoinedQuery(layer("joined")),
		baseLayer: runJoinedQuery(layer(joined.meta.base ?? "joined"))
	};
}
