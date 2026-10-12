import { Context, Schema, type Effect, type Scope, type Stream } from "effect";
import {
	LocalizationError,
	type LocalizationTargetEvidence,
	type LocalizationReviewSnapshot
} from "@ue-shed/localization";
import type { SavedAssetPackageTextEvent } from "@ue-shed/unreal-assets";
import type { PackageTextInventoryEntry, refreshPackageTextLayer } from "./package-text-layer.js";
import type { importLocalizationTarget } from "./localization-import.js";
import type { SnapshotStoreError } from "./snapshot-store.js";
import type { SnapshotFormatError } from "./snapshot-format.js";
import type { JoinedTargetReader } from "./joined-target-reader.js";
import type { TextCorpusQuery } from "./query.js";
import type { TextCorpus, TextCorpusSearchRequest, TextCorpusSearchPage } from "./schema.js";
import type { LocalizationJoin } from "./localization-schema.js";
import { LocalizationKeyChangePair } from "./localization-key-changes.js";
import type { refreshJoinedTarget } from "./joined-target.js";
import type { GameTextProjectIndex } from "./index-steps.js";
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
	/** Present on the steps implementation; optional for existing host-provided refresh adapters. */
	readonly project?: GameTextProjectIndex | undefined;
	readonly joined: JoinedTargetReader;
	readonly query: TextCorpusQuery;
	/** Asynchronous search adapter; worker-backed when selected by the host's layer. */
	readonly search: (
		request: TextCorpusSearchRequest
	) => Effect.Effect<TextCorpusSearchPage, IndexFailure>;
	readonly imported: ImportedTarget;
	readonly packages: Effect.Success<ReturnType<typeof refreshPackageTextLayer>>;
	readonly join: Effect.Success<ReturnType<typeof refreshJoinedTarget>>;
	readonly corpus: TextCorpus;
	readonly localizationJoin: LocalizationJoin;
	readonly evidence: LocalizationTargetEvidence;
	readonly review: LocalizationReviewSnapshot;
}

export type IndexFailure = SnapshotStoreError | SnapshotFormatError | GameTextIndexError;
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
