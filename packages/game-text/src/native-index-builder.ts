import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Context, Effect, Layer, Option, Schema } from "effect";
import {
	NativeGameTextIndexClient,
	nativeGameTextIndexClientLayer,
	encodeGameTextJoinInput,
	type AssetReaderConfiguration,
	type AssetReaderError,
	type GameTextIndexBuildRequest
} from "@ue-shed/unreal-assets";
import { GameTextIndexBuilder, typeScriptIndexBuilderLayer } from "./index-builder.js";
import { LocalizationImportSession } from "./localization-import-session.js";
import {
	SharedIndex,
	SharedIndexManifestSchema,
	LayerRecord,
	sharedIndexNodeLayer,
	sharedIndexDirectory,
	type SharedIndexOptions,
	type SharedIndexWriter
} from "./shared-index.js";
import { SnapshotStoreError } from "./snapshot-store.js";
import { writeSnapshotFile, type SnapshotSource } from "./snapshot-file.js";
import { snapshotCheck } from "./snapshot-format.js";
import { decodeWtf8, encodeWtf8 } from "./wtf8.js";

const unavailable = (operation: string, cause: unknown) =>
	new SnapshotStoreError({
		operation,
		code: "unavailable",
		message: String(cause),
		recovery: "Check the paired native reader and disposable Game Text cache, then retry."
	});
const nativeFailure = (cause: AssetReaderError) =>
	new SnapshotStoreError({
		operation: "native-index-builder",
		code:
			cause.code === "busy"
				? "busy"
				: cause.code === "invalid_input"
					? "invalid_input"
					: "unavailable",
		message: cause.message,
		recovery: "Resolve the native reader or cache failure and open a new build session."
	});
const io = <A>(operation: string, action: () => Promise<A>) =>
	Effect.tryPromise({ try: action, catch: (cause) => unavailable(operation, cause) });

class NativeBuildSession extends Context.Service<
	NativeBuildSession,
	{
		readonly refreshJoinedTarget: typeof import("./joined-target.js").refreshJoinedTarget;
	}
>()("@ue-shed/game-text/NativeBuildSession") {}

const makeWriter = Effect.fn("NativeIndexBuilder.writer")(function* (
	options: SharedIndexOptions,
	stage: string
) {
	const client = yield* NativeGameTextIndexClient;
	const identity =
		options.projectView?.kind === "source"
			? ["source"]
			: options.projectView
				? ["localization", options.projectView.target]
				: undefined;
	const base = {
		cacheRoot: options.cacheRoot,
		projectKey: options.projectKey,
		targetKey: options.targetKey
	};
	const configuration = identity
		? {
				...base,
				sharedProject: true as const,
				viewPrefix: `target-join.${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}.`
			}
		: { ...base, sharedProject: false as const };
	let closed = false;
	const begin = yield* client
		.execute({ action: "begin", configuration })
		.pipe(Effect.mapError(nativeFailure));
	let nativeIo = begin.io;
	let lookupStrings = 0,
		reusedStrings = 0;
	const stageTimes: Record<string, number> = {};
	let manifest = yield* Schema.decodeUnknownEffect(SharedIndexManifestSchema)(begin.root).pipe(
		Effect.mapError((cause) => unavailable("native-index-root", cause))
	);
	const command = Effect.fn("NativeIndexBuilder.execute")(function* (
		request: GameTextIndexBuildRequest
	) {
		if (closed)
			return yield* Effect.fail(
				unavailable("native-index-session", "The build session is closed.")
			);
		const result = yield* client.execute(request).pipe(Effect.mapError(nativeFailure));
		nativeIo = result.io;
		for (const [name, seconds] of Object.entries(result.stageSeconds))
			stageTimes[name] = (stageTimes[name] ?? 0) + seconds * 1000;
		if (result.root !== null)
			manifest = yield* Schema.decodeUnknownEffect(SharedIndexManifestSchema)(
				result.root
			).pipe(Effect.mapError((cause) => unavailable("native-index-root", cause)));
		return result;
	});
	let sequence = 0;
	const staged = (source: SnapshotSource, existing?: string) =>
		existing
			? Effect.succeed(existing)
			: io("native-index-stage", async () => {
					const file = join(stage, `${++sequence}.snapshot`);
					await writeSnapshotFile(file, source);
					return file;
				});
	const publish: SharedIndexWriter["publishBatch"] = Effect.fn("NativeIndexBuilder.publish")(
		function* (entries, removedNames) {
			const inputs = [];
			for (const entry of entries)
				inputs.push({
					name: entry.name,
					key: entry.key,
					file: manifest.layers[entry.key]
						? join(sharedIndexDirectory(options), manifest.layers[entry.key]!.file)
						: yield* staged(entry.source, entry.stagedFile)
				});
			const result = yield* command({
				action: "publish",
				configuration,
				inputs,
				...(removedNames ? { removedNames } : undefined)
			});
			return yield* Schema.decodeUnknownEffect(Schema.Array(LayerRecord))(
				result.records
			).pipe(Effect.mapError((cause) => unavailable("native-index-layer", cause)));
		}
	);
	const writer: SharedIndexWriter = {
		manifest: () => manifest,
		metrics: () => ({
			readBytes: nativeIo.storedBytes,
			indexReadBytes: nativeIo.indexBytes,
			appendedBytes: nativeIo.writtenBytes,
			lookupStrings,
			reusedStrings,
			probePasses: 0,
			sortMs: 0,
			probeMs: 0,
			appendMs: stageTimes.publish ?? 0,
			segments: manifest.segments.length,
			timings: {
				collectMs: 0,
				reuseMs: 0,
				layerEncodeMs: 0,
				layerVerifyMs: 0,
				garbageMs: 0,
				rootPublishMs: 0
			}
		}),
		publishBatch: publish,
		publish: (name, key, source) =>
			publish([{ name, key, source }]).pipe(Effect.map((records) => records[0]!)),
		publishCold: Effect.fn("NativeIndexBuilder.publishCold")(function* (entries, removedNames) {
			const inputs = [];
			for (const entry of entries)
				inputs.push({
					name: entry.name,
					key: entry.key,
					file: manifest.layers[entry.key]
						? join(sharedIndexDirectory(options), manifest.layers[entry.key]!.file)
						: yield* staged(entry.source, entry.stagedFile)
				});
			const result = yield* command({
				action: "publish",
				configuration,
				inputs,
				cold: true,
				...(removedNames ? { removedNames } : undefined)
			});
			return yield* Schema.decodeUnknownEffect(Schema.Array(LayerRecord))(
				result.records
			).pipe(Effect.mapError((cause) => unavailable("native-index-layer", cause)));
		}),
		publishIds: Effect.fn("NativeIndexBuilder.publishIds")(
			function* (name, key, source, generation, retained, removed) {
				const file = yield* staged({
					columns: source.columns.map((column) =>
						column.kind === "stringIds"
							? { name: column.name, kind: "u32", load: column.load }
							: column
					)
				});
				const stringColumns = Object.fromEntries(
					source.columns
						.filter((column) => column.kind === "stringIds")
						.map((column) => [column.name, column.domain!])
				);
				const result = yield* command({
					action: "publish_ids",
					configuration,
					name,
					key,
					file,
					generation,
					stringColumns,
					...(retained ? { retained } : undefined),
					...(removed ? { removed } : undefined)
				});
				return yield* Schema.decodeUnknownEffect(LayerRecord)(result.records[0]).pipe(
					Effect.mapError((cause) => unavailable("native-index-layer", cause))
				);
			}
		),
		intern: Effect.fn("NativeIndexBuilder.intern")(function* (domain, values) {
			const ids = new Uint32Array(values.length);
			for (let start = 0; start < values.length; ) {
				const chunks: Uint8Array[] = [];
				let bytes = 0,
					end = start;
				while (end < values.length && end - start < 8192) {
					const value = encodeWtf8(values[end]!);
					snapshotCheck(value.length <= 1024 ** 2, "strings", "String exceeds 1 MiB");
					if (end > start && bytes + value.length + 4 > 16 * 1024 ** 2) break;
					const length = Buffer.allocUnsafe(4);
					length.writeUInt32LE(value.length);
					chunks.push(length, value);
					bytes += value.length + 4;
					end++;
				}
				const file = join(stage, `${++sequence}.strings`);
				yield* io("native-index-intern", () => writeFile(file, Buffer.concat(chunks)));
				const previousCount = manifest.segments.reduce(
					(sum, segment) => sum + segment.count,
					0
				);
				const result = yield* command({ action: "intern", configuration, domain, file });
				lookupStrings += result.ids.length;
				reusedStrings += result.ids.filter((id) => id < previousCount).length;
				snapshotCheck(
					result.ids.length === end - start,
					"strings",
					"Native intern count differs"
				);
				ids.set(result.ids, start);
				start = end;
			}
			return ids;
		}),
		strings: Effect.fn("NativeIndexBuilder.strings")(function* (ids) {
			const values: string[] = [];
			// Each dictionary string is capped at 1 MiB; this bounds the response to 32 MiB.
			for (let start = 0; start < ids.length; start += 32) {
				const selected = ids.slice(start, start + 32),
					output = join(stage, `${++sequence}.strings`);
				const result = yield* command({
					action: "strings",
					configuration,
					ids: [...selected],
					output
				});
				const bytes = yield* io("native-index-strings", () => readFile(output));
				const size = (selected.length + 1) * 4;
				snapshotCheck(
					result.stringCount === selected.length && bytes.length >= size,
					"strings",
					"Invalid native string response"
				);
				for (let row = 0; row < selected.length; row++) {
					const begin = bytes.readUInt32LE(row * 4),
						end = bytes.readUInt32LE((row + 1) * 4);
					snapshotCheck(
						begin <= end && size + end <= bytes.length,
						"strings",
						"Invalid native string bounds"
					);
					values.push(decodeWtf8(bytes.subarray(size + begin, size + end)));
				}
			}
			return values;
		}),
		compact: (force) =>
			command({
				action: "compact",
				configuration,
				...(force === undefined ? undefined : { force })
			}).pipe(
				Effect.flatMap((result) =>
					result.compaction
						? Effect.succeed(result.compaction)
						: Effect.fail(unavailable("native-index-compact", "Missing result"))
				)
			)
	};
	const refreshJoinedTarget: typeof import("./joined-target.js").refreshJoinedTarget = Effect.fn(
		"NativeIndexBuilder.join"
	)(function* (input) {
		const file = join(stage, `${++sequence}.join.json`);
		yield* io("native-index-join-stage", () =>
			writeFile(file, JSON.stringify(encodeGameTextJoinInput(JSON.stringify(input))))
		);
		const result = (yield* command({ action: "join", configuration, file })).join;
		if (!result)
			return yield* Effect.fail(unavailable("native-index-join", "Missing join result"));
		if (!result.rebuilt)
			return {
				rebuilt: false,
				key: result.key,
				bytes: result.bytes,
				count: null,
				keyChanges: null
			};
		if (result.count === null || result.keyChanges === null)
			return yield* Effect.fail(unavailable("native-index-join", "Missing rebuilt counts"));
		if (result.strategy === "incremental") {
			if (result.affectedLines === null)
				return yield* Effect.fail(
					unavailable("native-index-join", "Missing affected row count")
				);
			return {
				rebuilt: true,
				strategy: "incremental" as const,
				key: result.key,
				bytes: result.bytes,
				count: result.count,
				keyChanges: result.keyChanges,
				affectedLines: result.affectedLines
			};
		}
		return {
			rebuilt: true,
			strategy: "full" as const,
			incrementalFallback: undefined,
			key: result.key,
			bytes: result.bytes,
			count: result.count,
			keyChanges: result.keyChanges
		};
	});
	return {
		writer,
		refreshJoinedTarget,
		close: () =>
			command({ action: "end", configuration }).pipe(
				Effect.ensuring(
					Effect.sync(() => {
						closed = true;
					})
				)
			)
	};
});

/** Opt-in native storage and joins. Current TS producers retain extraction and localization policy. */
export const nativeIndexBuilderLayer = (configuration: AssetReaderConfiguration) =>
	Layer.effect(
		GameTextIndexBuilder,
		Effect.gen(function* () {
			const fallback = yield* GameTextIndexBuilder;
			return GameTextIndexBuilder.of({
				...fallback,
				withSession: (request, effect) =>
					Effect.scoped(
						Effect.gen(function* () {
							const backing = yield* SharedIndex;
							const stage = yield* Effect.acquireRelease(
								io("native-index-stage", async () => {
									await mkdir(request.configuration.cacheRoot, {
										recursive: true
									});
									return mkdtemp(
										join(request.configuration.cacheRoot, "native-build-")
									);
								}),
								(path) =>
									Effect.promise(() => rm(path, { recursive: true, force: true }))
							);
							const native = yield* Effect.acquireRelease(
								makeWriter(request.configuration, stage),
								(native) =>
									native
										.close()
										.pipe(
											Effect.catch((cause) =>
												Effect.logWarning(
													"Native index session cleanup failed",
													cause
												)
											)
										)
							);
							const leased = SharedIndex.of({
								...backing,
								inspect: () => Effect.succeed(native.writer.manifest()),
								writer: () => Effect.succeed(native.writer)
							});
							return yield* effect.pipe(
								Effect.provideService(SharedIndex, leased),
								Effect.provideService(NativeBuildSession, native),
								Effect.provideService(LocalizationImportSession, {
									configuration: request.configuration,
									index: leased,
									...(request.files && native.writer.manifest().active.joined
										? { files: request.files }
										: undefined)
								})
							);
						})
					).pipe(
						Effect.provide(sharedIndexNodeLayer(request.configuration)),
						Effect.provide(nativeGameTextIndexClientLayer(configuration))
					),
				refreshJoinedTarget: Effect.fn("NativeIndexBuilder.refreshJoinedTarget")(
					function* (input) {
						const session = yield* Effect.serviceOption(NativeBuildSession);
						if (Option.isNone(session))
							return yield* Effect.fail(
								unavailable(
									"native-index-session",
									"Call withSession around native build operations."
								)
							);
						return yield* session.value.refreshJoinedTarget(input);
					}
				)
			});
		})
	).pipe(Layer.provide(typeScriptIndexBuilderLayer));
