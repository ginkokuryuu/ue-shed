import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vitest";
import { CustodianContractError, parseCustodianReport } from "./schema.js";

it.effect(
	"fails a value outside the contract with a domain error that keeps the schema issue",
	() =>
		Effect.gen(function* () {
			// A peer from another version sends a value this side does not know.
			const error = yield* Effect.flip(
				parseCustodianReport(JSON.parse('{ "unexpected": true }'))
			);
			expect(error).toBeInstanceOf(CustodianContractError);
			expect(error).toMatchObject({
				code: "invalid_contract",
				message: "The custodian report does not match the Project Custodian contract.",
				retrySafe: false
			});
			expect(error.cause).toBeDefined();
		})
);
