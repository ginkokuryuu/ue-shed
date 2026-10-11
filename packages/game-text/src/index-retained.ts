import { Effect, Exit, Ref, Scope } from "effect";
import { GameTextIndexRefresh, type GameTextIndexRefreshRequest } from "./index-refresh.js";

/** A host retains one pinned generation per model and releases it on replacement or shutdown. */
export const makeRetainedGameTextIndex = Effect.fn("GameTextIndex.retain")(function* () {
	const service = yield* GameTextIndexRefresh;
	const current = yield* Ref.make<Scope.Closeable | undefined>(undefined);
	const revision = yield* Ref.make(0);
	yield* Effect.addFinalizer(() =>
		Ref.get(current).pipe(
			Effect.flatMap((scope) => (scope ? Scope.close(scope, Exit.void) : Effect.void))
		)
	);
	return Effect.fn("GameTextIndex.retainedRefresh")(function* (
		request: GameTextIndexRefreshRequest
	) {
		const version = yield* Ref.updateAndGet(revision, (value) => value + 1);
		const scope = yield* Scope.make();
		const result = yield* service.refresh(request).pipe(
			Effect.provideService(Scope.Scope, scope),
			Effect.onError(() => Scope.close(scope, Exit.void))
		);
		yield* Effect.uninterruptible(
			Effect.gen(function* () {
				if ((yield* Ref.get(revision)) === version) {
					const previous = yield* Ref.getAndSet(current, scope);
					if (previous) yield* Scope.close(previous, Exit.void);
				} else yield* Scope.close(scope, Exit.void);
			})
		);
		return result;
	});
});
