import { Schema } from "effect";

/**
 * What a caller can do next after an expected failure, as a stable code beside the prose
 * `recovery`:
 *
 * - `fix_input`: the request, configuration or project is wrong; change it and try again.
 * - `retry`: the same request may succeed later without changes. Only valid when `retrySafe` is true.
 * - `reconcile`: state changed underneath the caller; re-read it, then decide whether to retry.
 * - `escalate`: the caller cannot fix this; report it with the error's context.
 */
export const ErrorNextStep = Schema.Literals(["fix_input", "retry", "reconcile", "escalate"]);
export type ErrorNextStep = typeof ErrorNextStep.Type;

/**
 * Guidance fields every UE Shed tagged error carries. Spread into a `Schema.TaggedError` field
 * struct. `retrySafe` states whether repeating the same operation is idempotent; it must be true
 * whenever `nextStep` is `retry`.
 */
export const ErrorGuidanceFields = {
	message: Schema.String,
	recovery: Schema.String,
	retrySafe: Schema.Boolean,
	nextStep: ErrorNextStep
};

/**
 * The original failure behind a classified error. Keep it here instead of stringifying it into
 * `message`; it is diagnostic evidence, not text to branch on.
 */
export const ErrorCauseFields = { cause: Schema.optionalKey(Schema.Defect()) };
