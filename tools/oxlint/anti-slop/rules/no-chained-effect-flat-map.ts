import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const sequencingSteps = new Set(["andThen", "flatMap"]);

function isSequencingStep(node: ESTree.Node): boolean {
	return (
		node.type === "CallExpression" &&
		node.callee.type === "MemberExpression" &&
		!node.callee.computed &&
		node.callee.object.type === "Identifier" &&
		node.callee.object.name === "Effect" &&
		node.callee.property.type === "Identifier" &&
		sequencingSteps.has(node.callee.property.name)
	);
}

function isPipeCall(node: ESTree.CallExpression): boolean {
	const callee = node.callee;
	if (callee.type === "Identifier") return callee.name === "pipe";
	return (
		callee.type === "MemberExpression" &&
		!callee.computed &&
		callee.property.type === "Identifier" &&
		callee.property.name === "pipe"
	);
}

/** Require sequential Effect steps to read as a generator instead of flatMap chains. */
export const noChainedEffectFlatMapRule = defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Disallow pipes with two or more Effect.flatMap or Effect.andThen steps; write the sequence as Effect.gen or an Effect.fn body."
		},
		messages: {
			chainedFlatMap:
				"This pipe sequences effects with several Effect.flatMap/Effect.andThen steps. Write the steps as `yield*` statements in Effect.gen or Effect.fn."
		}
	},
	createOnce(context) {
		return {
			CallExpression(node) {
				if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression")
					return;
				if (!isPipeCall(node)) return;
				if (node.arguments.filter(isSequencingStep).length < 2) return;
				context.report({ node, messageId: "chainedFlatMap" });
			}
		};
	}
});
