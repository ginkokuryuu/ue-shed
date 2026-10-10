import { Effect } from "effect";

/** Node adapter for the published synchronous TextCorpusQuery contract.
 * Input effects have no service requirements and use only the synchronous pinned file
 * handles supplied by synchronousJoinedTarget. The caller's SharedIndex scope owns those
 * handles; this adapter neither opens a second reader nor launches asynchronous work.
 * Effect's synchronous runner rejects an accidental asynchronous operation at this boundary.
 */
export const runJoinedQuery = <A, E>(effect: Effect.Effect<A, E>): A => Effect.runSync(effect);
