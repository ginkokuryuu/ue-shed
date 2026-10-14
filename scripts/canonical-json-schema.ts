import type { JsonSchema } from "effect";
import { deepStrictEqual } from "node:assert/strict";
import { canonicalJsonSchemaReferences } from "../packages/protocol/src/json-schema.ts";

export function assertJsonSchemaEquivalent(
	actual: JsonSchema.JsonSchema,
	expected: JsonSchema.JsonSchema,
	message?: string
): void {
	deepStrictEqual(
		canonicalJsonSchemaReferences(actual),
		canonicalJsonSchemaReferences(expected),
		message
	);
}

export { canonicalJsonSchemaReferences };
