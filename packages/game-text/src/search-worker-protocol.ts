import { Schema } from "effect";
import { TextCorpusSearchRequest, TextCorpusSearchPage } from "./schema.js";
import { SnapshotStoreError } from "./snapshot-store.js";
import { SnapshotFormatError } from "./snapshot-format.js";

const Id = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const SearchWorkerInput = Schema.Struct({
	configuration: Schema.Struct({
		cacheRoot: Schema.NonEmptyString,
		projectKey: Schema.NonEmptyString,
		targetKey: Schema.NonEmptyString
	}),
	generation: Schema.NonEmptyString,
	joinedKey: Schema.NonEmptyString
});
export type SearchWorkerInput = typeof SearchWorkerInput.Type;
export const SearchWorkerTask = Schema.Struct({
	id: Id,
	request: TextCorpusSearchRequest,
	cancelled: Schema.instanceOf(SharedArrayBuffer)
});
export const SearchWorkerReply = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("ready") }),
	Schema.Struct({ kind: Schema.Literal("result"), id: Id, page: TextCorpusSearchPage }),
	Schema.Struct({ kind: Schema.Literal("cancelled"), id: Id }),
	Schema.Struct({
		kind: Schema.Literal("failed"),
		id: Schema.optionalKey(Id),
		error: Schema.Union([SnapshotStoreError, SnapshotFormatError])
	})
]);
export type SearchWorkerReply = typeof SearchWorkerReply.Type;
export function searchWorkerFailure(operation: string, cause: unknown) {
	return cause instanceof SnapshotStoreError || cause instanceof SnapshotFormatError
		? cause
		: new SnapshotStoreError({
				operation,
				code: "unavailable",
				message: String(cause),
				recovery: "Refresh the Game Text index and retry the search."
			});
}
