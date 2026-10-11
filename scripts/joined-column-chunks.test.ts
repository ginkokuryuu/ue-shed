import { Effect } from "effect";
import { expect, it } from "vitest";
import { SharedIndex, sharedIndexNodeLayer } from "../packages/game-text/src/shared-index.ts";
import { openJoinedTarget } from "../packages/game-text/src/joined-target-reader.ts";
import { synchronousJoinedTarget } from "../packages/game-text/src/joined-query-reader.ts";
import { JoinedQueryData } from "../packages/game-text/src/joined-query-data.ts";
import { incrementJoinedTarget } from "../packages/game-text/src/joined-target-incremental.ts";
import { joinedPhysicalChunkName } from "../packages/game-text/src/joined-column-chunks.ts";
import { withJoinCache, joinStoreOptions } from "./columnar-join.test-support.ts";
import { target } from "../packages/game-text/src/localization.test-support.ts";

it("large path projections keep physical chunk names within the directory field", () => {
	const names = [
		"query.raw.id_utf8",
		"query.place.manifest_bytes",
		"query.place.namespace_values"
	];
	const fields = names.flatMap((name, column) =>
		[0, 1].map((part) => joinedPhysicalChunkName(name, column, part))
	);
	expect(fields.every((field) => /^[\x20-\x7e]{1,31}$/u.test(field))).toBe(true);
	expect(new Set(fields).size).toBe(fields.length);
});

it("reads and patches a logical ID arena across bounded physical sections", async () => {
	await withJoinCache(async (cache) => {
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const index = yield* SharedIndex,
						writer = yield* index.writer();
					const generation = writer.manifest().generation;
					const metadata = {
						version: 3,
						count: 0,
						aliases: { "state.alias": "state" },
						chunks: { "query.raw.id_utf8": ["id.chunk0", "id.chunk1"] },
						generation,
						input: { projectRoot: cache, target },
						dependencies: {},
						packageNames: [],
						packageStarts: [0],
						pairs: [],
						ambiguous: 0,
						oldCandidates: 0,
						reducedSourceChecking: []
					};
					const bytes = <A extends typeof metadata>(value: A) =>
						new TextEncoder().encode(JSON.stringify(value));
					yield* writer.publishIds(
						"joined",
						"chunk-base",
						{
							columns: [
								{
									name: "id.chunk0",
									kind: "u32",
									load: async () => Uint32Array.of(1, 2)
								},
								{
									name: "id.chunk1",
									kind: "u32",
									load: async () => Uint32Array.of(3, 4, 5)
								},
								{
									name: "state",
									kind: "u32",
									load: async () => Uint32Array.of(0, 0)
								},
								{
									name: "join.meta",
									kind: "bytes",
									load: async () => bytes(metadata)
								}
							]
						},
						generation
					);
					const base = yield* openJoinedTarget();
					expect(Array.from(yield* base.layer.section("query.raw.id_utf8"))).toEqual([
						1, 2, 3, 4, 5
					]);
					expect(
						Array.from(
							yield* synchronousJoinedTarget(base).layer.section("query.raw.id_utf8")
						)
					).toEqual([1, 2, 3, 4, 5]);
					yield* writer.publishIds(
						"joined",
						"chunk-patch",
						{
							columns: [
								{
									name: "patch.rows",
									kind: "u32",
									load: async () => Uint32Array.of(1, 3)
								},
								{
									name: "patch.ids",
									kind: "u32",
									load: async () => Uint32Array.of(12, 14)
								},
								{
									name: "patch.state.rows",
									kind: "u32",
									load: async () => Uint32Array.of(1)
								},
								{
									name: "patch.state",
									kind: "u32",
									load: async () => Uint32Array.of(2)
								},
								{
									name: "join.meta",
									kind: "bytes",
									load: async () =>
										bytes({
											...metadata,
											base: "chunk-base",
											patches: {
												"query.raw.id_utf8": "patch.ids",
												state: "patch.state"
											},
											patchRows: { state: "patch.state.rows" }
										})
								}
							]
						},
						generation,
						{ "joined-base": "chunk-base" }
					);
					const patched = yield* openJoinedTarget();
					expect(Array.from(yield* patched.layer.section("query.raw.id_utf8"))).toEqual([
						1, 12, 3, 14, 5
					]);
					expect(
						Array.from(
							yield* synchronousJoinedTarget(patched).layer.section(
								"query.raw.id_utf8"
							)
						)
					).toEqual([1, 12, 3, 14, 5]);
					const data = new JoinedQueryData(patched);
					expect(Array.from(data.column("state"))).toEqual([0, 2]);
					expect(Array.from(data.column("state.alias"))).toEqual([0, 0]);
					// A compaction changes the generation while the overlay metadata still
					// describes its old base. Refresh must rebuild before opening that base.
					yield* writer.compact(true);
					let fallback = "";
					const increment = yield* incrementJoinedTarget(
						{ projectRoot: cache, target },
						"after-compaction",
						{},
						yield* index.open(),
						writer,
						(reason) => {
							fallback = reason;
						}
					);
					expect(increment).toBeNull();
					expect(fallback).toBe("generation-or-retired-base");
				})
			).pipe(Effect.provide(sharedIndexNodeLayer(joinStoreOptions(cache, cache, "chunks"))))
		);
	});
});
