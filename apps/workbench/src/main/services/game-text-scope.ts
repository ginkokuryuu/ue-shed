import { Effect } from "effect";

/** Reader pins cover the complete host operation, including asynchronous file and worker work. */
export const scopedGameTextOperation =
	<Args extends unknown[], A, E, R>(operation: (...args: Args) => Effect.Effect<A, E, R>) =>
	(...args: Args) =>
		Effect.scoped(operation(...args));
