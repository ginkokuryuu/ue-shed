import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const effectFunctionBuilders = new Set(["fn", "fnUntraced"]);

function isEffectFunctionBuilder(node: ESTree.Node): boolean {
	// Effect.fn("name")(body) and Effect.fnUntraced(body).
	const builder = node.type === "CallExpression" ? node.callee : node;
	return (
		builder.type === "MemberExpression" &&
		!builder.computed &&
		builder.object.type === "Identifier" &&
		builder.object.name === "Effect" &&
		builder.property.type === "Identifier" &&
		effectFunctionBuilders.has(builder.property.name)
	);
}

function isPipeCall(node: ESTree.Node | null | undefined): boolean {
	return (
		node?.type === "CallExpression" &&
		node.callee.type === "MemberExpression" &&
		!node.callee.computed &&
		node.callee.property.type === "Identifier" &&
		node.callee.property.name === "pipe"
	);
}

/** Require Effect.fn bodies to pass trailing transforms as Effect.fn arguments, not a final pipe. */
export const preferEffectFnPipeablesRule = defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Disallow an Effect.fn generator whose whole body is `return yield* effect.pipe(...)`; pass the transforms to Effect.fn instead."
		},
		messages: {
			pipeInBody:
				"Pass these transforms straight to Effect.fn as extra arguments (`Effect.fn(name)(function* () { ... }, transform)`); each receives the effect and the call's arguments."
		}
	},
	createOnce(context) {
		return {
			CallExpression(node) {
				if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression")
					return;
				if (!isEffectFunctionBuilder(node.callee)) return;
				const body = node.arguments[0];
				if (body?.type !== "FunctionExpression" || !body.generator || body.body === null)
					return;
				if (node.arguments.length > 1) return;
				const statements = body.body.body;
				if (statements.length !== 1) return;
				const [statement] = statements;
				if (statement?.type !== "ReturnStatement") return;
				const returned = statement.argument;
				if (returned?.type !== "YieldExpression" || !returned.delegate) return;
				if (!isPipeCall(returned.argument)) return;
				context.report({ node: statement, messageId: "pipeInBody" });
			}
		};
	}
});
