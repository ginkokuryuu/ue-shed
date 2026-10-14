import { Effect, Scheduler } from "effect";

/** Node adapter for the published synchronous TextCorpusQuery contract.
 * Input effects have no service requirements and use only the synchronous pinned file
 * handles supplied by synchronousJoinedTarget. The caller's SharedIndex scope owns those
 * handles; this adapter neither opens a second reader nor launches asynchronous work.
 * Disable cooperative yielding here so a synchronous cache lookup cannot yield into a child fiber.
 * Effect's synchronous runner rejects an accidental asynchronous operation at this boundary.
 */
export const runJoinedQuery = <A, E>(effect: Effect.Effect<A, E>): A =>
	Effect.runSync(effect.pipe(Effect.provideService(Scheduler.PreventSchedulerYield, true)));
