import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vitest";
import { ScenarioContractError, parseScenarioRun } from "./schema.js";

it.effect(
	"fails a value outside the contract with a domain error that keeps the schema issue",
	() =>
		Effect.gen(function* () {
			// A peer from another version sends a value this side does not know.
			const error = yield* Effect.flip(
				parseScenarioRun(JSON.parse('{ "unexpected": true }'))
			);
			expect(error).toBeInstanceOf(ScenarioContractError);
			expect(error).toMatchObject({
				code: "invalid_contract",
				message: "The scenario run does not match the scenario contract.",
				retrySafe: false
			});
			expect(error.cause).toBeDefined();
		})
);
