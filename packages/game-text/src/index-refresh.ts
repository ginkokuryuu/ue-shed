import { realpath } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Context, Effect, Layer, Metric, Schema, type Scope, type Stream } from "effect";
import {
	readLocalizationReview,
	LocalizationFileAccessLive,
	LocalizationEvidence
} from "@ue-shed/localization";
import type { SavedAssetPackageTextEvent } from "@ue-shed/unreal-assets";
import { SharedIndex, sharedIndexNodeLayer } from "./shared-index.js";
import { SnapshotStoreError } from "./snapshot-store.js";
import { SnapshotFormatError } from "./snapshot-format.js";
import type { refreshPackageTextLayer, PackageTextInventoryEntry } from "./package-text-layer.js";
import type { importLocalizationTarget } from "./localization-import.js";
import { GameTextIndexBuilder } from "./index-builder.js";
import { columnarTextCorpusQuery } from "./columnar-query.js";
import type { TextCorpusQuery } from "./query.js";
import type { refreshJoinedTarget } from "./joined-target.js";
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
		recovery: Schema.String
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
	targetName: Schema.NonEmptyString,
	changedFiles: Schema.optionalKey(Schema.Array(Schema.String))
});
export type GameTextIndexRefreshRequest = typeof GameTextIndexRefreshRequest.Type;

type ImportedTarget = Effect.Success<ReturnType<typeof importLocalizationTarget>>;
export interface GameTextIndexRefreshResult {
	readonly joined: JoinedTargetReader;
	readonly query: TextCorpusQuery;
	readonly imported: ImportedTarget;
	readonly packages: Effect.Success<ReturnType<typeof refreshPackageTextLayer>>;
	readonly join: Effect.Success<ReturnType<typeof refreshJoinedTarget>>;
}

type IndexFailure = SnapshotStoreError | SnapshotFormatError | GameTextIndexError;
export class GameTextIndexRefresh extends Context.Service<
	GameTextIndexRefresh,
	{
		readonly refresh: (
			request: GameTextIndexRefreshRequest
		) => Effect.Effect<GameTextIndexRefreshResult, IndexFailure, Scope.Scope>;
	}
>()("@ue-shed/game-text/GameTextIndexRefresh") {}

const refreshes = Metric.counter("game_text.index.refreshes");
const refreshDuration = Metric.histogram("game_text.index.refresh_duration_ms", {
	boundaries: [1, 10, 100, 1000, 10000, 60000, 900000]
});
const failure = (operation: string, message: string, recovery: string) =>
	new GameTextIndexError({ operation, message, recovery });

/** One writer lease includes inventory, packages, localization, review and the join. */
export const gameTextIndexRefreshLayer = (cacheRoot: string) =>
	Layer.effect(
		GameTextIndexRefresh,
		Effect.gen(function* () {
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
						targetKey: request.targetName
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
										return { ...previous.meta.input.fileErrors };
									})
								);
							return yield* Effect.gen(function* () {
								const inventory = yield* source.inventory({
									...request,
									projectRoot
								});
								const byPath = new Map(
									inventory.map((entry) => [entry.path, entry])
								);
								const imported = yield* Effect.scoped(
									builder.importLocalizationTarget({
										projectRoot,
										cacheRoot,
										targetName: request.targetName
									})
								).pipe(
									Effect.provideService(LocalizationEvidence, evidence),
									Effect.mapError((cause) =>
										cause instanceof SnapshotFormatError ||
										cause instanceof SnapshotStoreError
											? cause
											: failure("localization", cause.message, cause.recovery)
									)
								);
								const packages = yield* Effect.scoped(
									builder.refreshPackageTextLayer({
										inventory,
										read: (paths) =>
											source.read(
												projectRoot,
												paths.map((path) => byPath.get(path)!)
											)
									})
								);
								for (const file of imported.files)
									delete fileErrors[file.relativePath];
								for (const diagnostic of imported.diagnostics)
									if (diagnostic.relativePath)
										fileErrors[diagnostic.relativePath] = diagnostic.error.code;
								const review = yield* readLocalizationReview({
									projectRoot,
									target: imported.target.name
								}).pipe(
									Effect.provide(LocalizationFileAccessLive),
									Effect.mapError((cause) =>
										failure("review", cause.message, cause.recovery)
									)
								);
								const joinInput = {
									projectRoot,
									target: imported.target,
									fileErrors
								};
								if (review.contentHash !== null)
									Object.assign(joinInput, { review: review.file });
								const join = yield* Effect.scoped(
									builder.refreshJoinedTarget(joinInput)
								);
								return { imported, packages, join };
							});
						})
					);
					const joined = yield* openJoinedTarget().pipe(Effect.provide(indexLayer));
					const query = yield* Effect.try({
						try: () => columnarTextCorpusQuery(joined),
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
					return { ...result, joined, query };
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
			return GameTextIndexRefresh.of({ refresh });
		})
	);
