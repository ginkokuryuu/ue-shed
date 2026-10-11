import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Cache, Context, Effect, Layer, Metric, Schema, type Scope, type Stream } from "effect";
import {
	readLocalizationReview,
	emptyLocalizationReviewFile,
	defaultLocalizationReviewPath,
	LocalizationFileAccessLive,
	LocalizationEvidence,
	LocalizationTarget,
	LocalizationError,
	type LocalizationTargetEvidence,
	type LocalizationReviewSnapshot
} from "@ue-shed/localization";
import type { SavedAssetPackageTextEvent } from "@ue-shed/unreal-assets";
import { SharedIndex, sharedIndexNodeLayer } from "./shared-index.js";
import { SnapshotStoreError } from "./snapshot-store.js";
import { SnapshotFormatError } from "./snapshot-format.js";
import type { refreshPackageTextLayer, PackageTextInventoryEntry } from "./package-text-layer.js";
import type { importLocalizationTarget } from "./localization-import.js";
import { GameTextIndexBuilder } from "./index-builder.js";
import type { JoinedQueryProjection } from "./joined-query-data.js";
import { instrumentIndexQuery } from "./index-query.js";
import { columnarTextCorpusQuery } from "./columnar-query.js";
import type { TextCorpusQuery } from "./query.js";
import type { refreshJoinedTarget } from "./joined-target.js";
import {
	indexedTextCorpus,
	indexedLocalizationJoin,
	readIndexedLocalizationEvidence
} from "./index-context.js";
import type { TextCorpus } from "./schema.js";
import type { LocalizationJoin } from "./localization-schema.js";
import type { JoinedTargetInput } from "./joined-target.js";
import { LocalizationKeyChangePair } from "./localization-key-changes.js";
import {
	openJoinedTarget,
	readJoinedTarget,
	type JoinedTargetReader
} from "./joined-target-reader.js";

export class GameTextIndexError extends Schema.TaggedErrorClass<GameTextIndexError>()(
	"GameTextIndexError",
	{
		operation: Schema.String,
		message: Schema.String,
		recovery: Schema.String,
		retrySafe: Schema.optionalKey(Schema.Boolean),
		localizationError: Schema.optionalKey(LocalizationError)
	}
) {}

export interface GameTextIndexSourceRequest {
	readonly projectRoot: string;
	/** Absent means a complete refresh; an empty list means reuse every saved input. */
	readonly changedFiles?: readonly string[];
}

/** Inventory and verified reads are host adapters; gathering and caching stay in this library. */
export class GameTextIndexSource extends Context.Service<
	GameTextIndexSource,
	{
		readonly inventory: (
			request: GameTextIndexSourceRequest
		) => Effect.Effect<readonly PackageTextInventoryEntry[], GameTextIndexError>;
		/** Reads must verify the complete package-and-sidecar signature around extraction. */
		readonly read: (
			projectRoot: string,
			entries: readonly PackageTextInventoryEntry[]
		) => Stream.Stream<typeof SavedAssetPackageTextEvent.Type, GameTextIndexError>;
	}
>()("@ue-shed/game-text/GameTextIndexSource") {}

export const GameTextIndexRefreshRequest = Schema.Struct({
	projectRoot: Schema.NonEmptyString,
	targetName: Schema.optionalKey(Schema.NonEmptyString),
	changedFiles: Schema.optionalKey(Schema.Array(Schema.String)),
	keyChangePairs: Schema.optionalKey(Schema.Array(LocalizationKeyChangePair)),
	tolerateReviewErrors: Schema.optionalKey(Schema.Boolean),
	requireManifest: Schema.optionalKey(Schema.Boolean),
	savedPackages: Schema.optionalKey(Schema.Boolean)
});
export type GameTextIndexRefreshRequest = typeof GameTextIndexRefreshRequest.Type;

type ImportedTarget = Effect.Success<ReturnType<typeof importLocalizationTarget>>;
export interface GameTextIndexRefreshResult {
	readonly joined: JoinedTargetReader;
	readonly query: TextCorpusQuery;
	readonly imported: ImportedTarget;
	readonly packages: Effect.Success<ReturnType<typeof refreshPackageTextLayer>>;
	readonly join: Effect.Success<ReturnType<typeof refreshJoinedTarget>>;
	readonly corpus: TextCorpus;
	readonly localizationJoin: LocalizationJoin;
	readonly evidence: LocalizationTargetEvidence;
	readonly review: LocalizationReviewSnapshot;
}

type IndexFailure = SnapshotStoreError | SnapshotFormatError | GameTextIndexError;
export class GameTextIndexRefresh extends Context.Service<
	GameTextIndexRefresh,
	{
		readonly refresh: (
			request: GameTextIndexRefreshRequest
		) => Effect.Effect<GameTextIndexRefreshResult, IndexFailure, Scope.Scope>;
		readonly invalidate: (
			request: GameTextIndexRefreshRequest
		) => Effect.Effect<void, IndexFailure>;
	}
>()("@ue-shed/game-text/GameTextIndexRefresh") {}

type MutableFileProvenances = {
	-readonly [K in keyof NonNullable<JoinedTargetInput["fileProvenances"]>]: NonNullable<
		JoinedTargetInput["fileProvenances"]
	>[K];
};
type MutableFileDiagnostics = {
	-readonly [K in keyof NonNullable<JoinedTargetInput["fileDiagnostics"]>]: NonNullable<
		JoinedTargetInput["fileDiagnostics"]
	>[K];
};

const refreshes = Metric.counter("game_text.index.refreshes");
const refreshDuration = Metric.histogram("game_text.index.refresh_duration_ms", {
	boundaries: [1, 10, 100, 1000, 10000, 60000, 900000]
});
const failure = (operation: string, message: string, recovery: string) =>
	new GameTextIndexError({ operation, message, recovery });

const savedTarget = Schema.decodeUnknownSync(LocalizationTarget)({
	name: "SavedText",
	source: "config_only",
	nativeCulture: null,
	cultures: [],
	configs: [],
	outputPaths: {
		manifest: null,
		archives: {},
		portableObjects: {},
		resources: {},
		locmeta: null,
		wordCount: null,
		conflicts: null
	},
	poFormat: "Unreal",
	collapseMode: "IdenticalTextIdAndSource"
});

/** One writer lease includes inventory, packages, localization, review and the join. */
export const gameTextIndexRefreshLayer = (cacheRoot: string) =>
	Layer.effect(
		GameTextIndexRefresh,
		Effect.gen(function* () {
			const projections = yield* Cache.make({
				capacity: 2,
				lookup: (_key: string) =>
					Effect.sync((): JoinedQueryProjection => ({ columns: new Map() }))
			});
			const source = yield* GameTextIndexSource;
			const evidence = yield* LocalizationEvidence;
			const builder = yield* GameTextIndexBuilder;
			const refresh = Effect.fn("GameTextIndex.refresh")(
				function* (input: GameTextIndexRefreshRequest) {
					const request = yield* Schema.decodeUnknownEffect(GameTextIndexRefreshRequest)(
						input
					).pipe(
						Effect.mapError((cause) =>
							failure(
								"request",
								String(cause),
								"Choose a project and localization target."
							)
						)
					);
					const projectRoot = yield* Effect.tryPromise({
						try: () => realpath(request.projectRoot),
						catch: (cause) =>
							failure(
								"project",
								String(cause),
								"Choose an accessible Unreal project directory."
							)
					});
					const configuration = {
						cacheRoot,
						projectKey: projectRoot,
						targetKey: request.targetName ?? savedTarget.name
					};
					const indexLayer = sharedIndexNodeLayer(configuration);
					const started = performance.now();
					const result = yield* builder.withSession(
						{
							configuration,
							...(request.changedFiles === undefined
								? undefined
								: { files: request.changedFiles })
						},
						Effect.gen(function* () {
							const index = yield* SharedIndex;
							let fileErrors: Record<string, string> = {};
							let fileProvenances: MutableFileProvenances = {};
							let fileDiagnostics: MutableFileDiagnostics = {};
							if (
								request.changedFiles !== undefined &&
								(yield* index.inspect()).active.joined
							)
								fileErrors = yield* Effect.scoped(
									Effect.gen(function* () {
										const previous = yield* readJoinedTarget(
											yield* index.open(),
											true
										);
										fileProvenances = {
											...previous.meta.input.fileProvenances
										};
										fileDiagnostics = {
											...previous.meta.input.fileDiagnostics
										};
										return { ...previous.meta.input.fileErrors };
									})
								);
							return yield* Effect.gen(function* () {
								const imported =
									request.targetName === undefined
										? {
												target: savedTarget,
												files: [],
												diagnostics: [],
												profile: null
											}
										: yield* Effect.scoped(
												builder.importLocalizationTarget({
													projectRoot,
													cacheRoot,
													targetName: request.targetName
												})
											).pipe(
												Effect.provideService(
													LocalizationEvidence,
													evidence
												),
												Effect.mapError((cause) =>
													cause instanceof SnapshotFormatError ||
													cause instanceof SnapshotStoreError
														? cause
														: failure(
																"localization",
																cause.message,
																cause.recovery
															)
												)
											);
								const manifestFailure = imported.diagnostics.find(
									(item) =>
										item.relativePath === imported.target.outputPaths.manifest
								);
								if (request.requireManifest && manifestFailure)
									return yield* Effect.fail(
										new GameTextIndexError({
											operation: "manifest",
											message: manifestFailure.error.message,
											recovery: manifestFailure.error.recovery,
											localizationError: manifestFailure.error
										})
									);
								const inventory =
									request.savedPackages === false
										? []
										: yield* source.inventory({
												...request,
												projectRoot
											});
								const byPath = new Map(
									inventory.map((entry) => [entry.path, entry])
								);
								const retainedPackages =
									request.savedPackages === false &&
									Object.keys((yield* index.inspect()).active).some((name) =>
										name.startsWith("package-text.")
									);
								const packages = retainedPackages
									? {
											readPackages: 0,
											reusedPackages: 0,
											changedShards: 0,
											removedShards: 0,
											published: false,
											profile: (yield* index.writer()).metrics()
										}
									: yield* Effect.scoped(
											builder.refreshPackageTextLayer({
												inventory,
												...(request.changedFiles === undefined
													? undefined
													: { changedFiles: request.changedFiles }),
												read: (paths) =>
													source.read(
														projectRoot,
														paths.map((path) => byPath.get(path)!)
													)
											})
										);
								for (const file of imported.files) {
									delete fileErrors[file.relativePath];
									delete fileDiagnostics[file.relativePath];
									fileProvenances[file.relativePath] = file.provenance;
								}
								for (const diagnostic of imported.diagnostics)
									if (diagnostic.relativePath) {
										fileErrors[diagnostic.relativePath] = diagnostic.error.code;
										fileDiagnostics[diagnostic.relativePath] = diagnostic.error;
										delete fileProvenances[diagnostic.relativePath];
									}
								const review = yield* readLocalizationReview({
									projectRoot,
									target: imported.target.name
								}).pipe(
									Effect.provide(LocalizationFileAccessLive),
									Effect.catch((cause) =>
										request.tolerateReviewErrors
											? Effect.succeed({
													file: emptyLocalizationReviewFile(
														imported.target.name
													),
													relativePath: defaultLocalizationReviewPath(
														imported.target.name
													),
													contentHash: null
												})
											: Effect.fail(cause)
									),
									Effect.mapError((cause) =>
										failure("review", cause.message, cause.recovery)
									)
								);
								const joinInput = {
									force: Boolean(
										(yield* index.inspect()).active["joined.invalidated"]
									),
									projectRoot,
									target: imported.target,
									fileErrors,
									fileProvenances,
									fileDiagnostics,
									...(request.keyChangePairs === undefined
										? undefined
										: { keyChangePairs: request.keyChangePairs })
								};
								if (review.contentHash !== null)
									Object.assign(joinInput, { review: review.file });
								const join = yield* Effect.scoped(
									builder.refreshJoinedTarget(joinInput)
								);
								if ((yield* index.inspect()).active["joined.invalidated"])
									yield* (yield* index.writer()).publishBatch(
										[],
										["joined.invalidated"]
									);
								return { imported, packages, join, review };
							});
						})
					);
					const joined = yield* openJoinedTarget().pipe(Effect.provide(indexLayer));
					const projection = yield* Cache.get(
						projections,
						`${joined.reader.manifest.generation}:${joined.reader.manifest.active.joined}`
					);
					const query = yield* Effect.try({
						try: () =>
							instrumentIndexQuery(
								columnarTextCorpusQuery(joined, undefined, projection)
							),
						catch: (cause) =>
							failure(
								"query",
								String(cause),
								"Clear the disposable Game Text index and refresh."
							)
					});
					yield* Metric.update(refreshes, 1);
					yield* Metric.update(refreshDuration, performance.now() - started);
					yield* Effect.annotateCurrentSpan({
						"game_text.index.packages_read": result.packages.readPackages,
						"game_text.index.join_rebuilt": result.join.rebuilt,
						"game_text.index.generation": joined.reader.manifest.generation
					});
					const indexedEvidence = yield* readIndexedLocalizationEvidence(joined).pipe(
						Effect.provide(LocalizationFileAccessLive),
						Effect.mapError((cause) =>
							failure(
								"evidence",
								String(cause),
								"Refresh the Game Text index and retry."
							)
						)
					);
					return {
						...result,
						joined,
						query,
						evidence: indexedEvidence,
						corpus: indexedTextCorpus(joined, query),
						localizationJoin: indexedLocalizationJoin(joined, query)
					};
				},
				Effect.mapError((cause) =>
					cause instanceof GameTextIndexError ||
					cause instanceof SnapshotStoreError ||
					cause instanceof SnapshotFormatError
						? cause
						: failure(
								"index",
								cause.message,
								"Clear the disposable Game Text index and refresh."
							)
				)
			);
			const invalidate = Effect.fn("GameTextIndex.invalidate")(function* (
				request: GameTextIndexRefreshRequest
			) {
				const projectRoot = yield* Effect.tryPromise({
					try: () => realpath(request.projectRoot),
					catch: (cause) =>
						failure("project", String(cause), "Choose an accessible project directory.")
				});
				yield* builder.withSession(
					{
						configuration: {
							cacheRoot,
							projectKey: projectRoot,
							targetKey: request.targetName ?? savedTarget.name
						}
					},
					Effect.gen(function* () {
						const index = yield* SharedIndex,
							writer = yield* index.writer();
						const active = writer.manifest().active;
						const removed = [...(request.changedFiles ?? [])].filter(
							(name) => active[name] !== undefined
						);
						if (active.joined)
							yield* writer.publish(
								"joined.invalidated",
								`invalidate:${randomUUID()}`,
								{
									columns: [
										{
											name: "invalidate",
											kind: "bytes",
											load: async () => Uint8Array.of(1)
										}
									]
								}
							);
						if (removed.length) yield* writer.publishBatch([], removed);
					})
				);
			});
			return GameTextIndexRefresh.of({ refresh, invalidate });
		})
	);
