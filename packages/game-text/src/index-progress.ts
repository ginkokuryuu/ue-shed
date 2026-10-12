import { Context, Schema } from "effect";

/** Counts describe the current stage, not a percentage of the whole refresh. */
export const GameTextIndexProgress = Schema.Struct({
	phase: Schema.Literals([
		"inventory",
		"localization",
		"packages",
		"joining",
		"opening",
		"ready",
		"failed"
	]),
	completed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	total: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
});
export type GameTextIndexProgress = typeof GameTextIndexProgress.Type;

/** Optional, operation-scoped observation; hosts own presentation and transport. */
export const GameTextIndexProgressReporter = Context.Reference<
	(progress: GameTextIndexProgress) => void
>("@ue-shed/game-text/GameTextIndexProgressReporter", {
	defaultValue: () => () => {}
});
