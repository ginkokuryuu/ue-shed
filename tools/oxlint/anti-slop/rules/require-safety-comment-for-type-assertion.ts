import { defineRule } from "@oxlint/plugins";

import type { ESTree, SourceCode } from "@oxlint/plugins";

type TypeAssertion = ESTree.TSAsExpression | ESTree.TSTypeAssertion;

const commentOwnerKinds = new Set([
	"ExpressionStatement",
	"PropertyDefinition",
	"ReturnStatement",
	"ThrowStatement",
	"VariableDeclaration"
]);

function isConstAssertion(node: TypeAssertion): boolean {
	return (
		node.typeAnnotation.type === "TSTypeReference" &&
		node.typeAnnotation.typeName.type === "Identifier" &&
		node.typeAnnotation.typeName.name === "const"
	);
}

const productionSourcePattern = /(?:^|\/)(?:apps|extensions|packages)\/[^/]+\/src\//u;
const testSourcePattern = /(?:\.test\.|\.test-support\.|\.e2e\.|\/e2e\/)/u;

/** Production source must name the tests that fail when a SAFETY invariant breaks. */
function requiresVerification(filename: string): boolean {
	const path = filename.replaceAll("\\", "/");
	return productionSourcePattern.test(path) && !testSourcePattern.test(path);
}

type SafetyComment = "missing" | "unverified" | "verified";

function safetyComment(sourceCode: SourceCode, node: TypeAssertion): SafetyComment {
	let current: ESTree.Node = node;
	while (true) {
		const comments = sourceCode
			.getCommentsBefore(current)
			.filter((comment) => comment.end <= node.start);
		if (comments.some((comment) => /\bSAFETY\s*:/u.test(comment.value))) {
			return comments.some((comment) => /\bVerified by\s*:/u.test(comment.value))
				? "verified"
				: "unverified";
		}
		if (commentOwnerKinds.has(current.type) || current.parent.type === "Program") {
			return "missing";
		}
		current = current.parent;
	}
}

/** Require every non-const type assertion to state the invariant TypeScript cannot express. */
export const requireSafetyCommentForTypeAssertionRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Require a nearby SAFETY comment for every TypeScript type assertion except const assertions."
		},
		messages: {
			missingSafetyComment:
				"This type assertion has no `SAFETY:` justification. State the checked invariant immediately before the assertion or its containing statement."
		}
	},
	createOnce(context) {
		const checkAssertion = (node: TypeAssertion) => {
			if (isConstAssertion(node)) return;
			if (safetyComment(context.sourceCode, node) !== "missing") return;
			context.report({ node, messageId: "missingSafetyComment" });
		};

		return {
			TSAsExpression: checkAssertion,
			TSTypeAssertion: checkAssertion
		};
	}
});

/** Require production SAFETY justifications to name the tests that fail if the invariant breaks. */
export const requireSafetyVerificationRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Require a `Verified by:` line beside every SAFETY comment on a type assertion in apps, extensions and packages source, outside tests."
		},
		messages: {
			missingVerification:
				"This `SAFETY:` justification has no `Verified by:` line. Name the tests that fail if the invariant breaks, in the same comment block."
		}
	},
	createOnce(context) {
		const checkAssertion = (node: TypeAssertion) => {
			if (isConstAssertion(node) || !requiresVerification(context.filename)) return;
			if (safetyComment(context.sourceCode, node) !== "unverified") return;
			context.report({ node, messageId: "missingVerification" });
		};

		return {
			TSAsExpression: checkAssertion,
			TSTypeAssertion: checkAssertion
		};
	}
});
