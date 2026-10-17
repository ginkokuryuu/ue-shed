import { defineRule } from "@oxlint/plugins";

const planPhasePattern = /\bPhase\s+\d+\b/u;

/** Ban comments that point at an implementation plan's phase instead of describing the code. */
export const noPlanPhaseCommentsRule = defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Disallow `Phase N` in comments; plans are archived and renumbered, so describe what the code does instead."
		},
		messages: {
			planPhase:
				"This comment refers to a plan phase. Describe what the code does and why; plans are archived and their phases stop meaning anything to readers."
		}
	},
	createOnce(context) {
		return {
			Program() {
				for (const comment of context.sourceCode.getAllComments()) {
					if (planPhasePattern.test(comment.value)) {
						context.report({ loc: comment.loc, messageId: "planPhase" });
					}
				}
			}
		};
	}
});
