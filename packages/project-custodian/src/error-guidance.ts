import { Schema } from "effect";

export const ErrorGuidanceFields = {
	message: Schema.String,
	recovery: Schema.String,
	retrySafe: Schema.Boolean,
	nextStep: Schema.Literals(["fix_input", "retry", "reconcile", "escalate"])
};
