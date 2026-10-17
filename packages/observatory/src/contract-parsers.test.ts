import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vitest";
import { WorldScoutContractError, parseWorldScoutResult } from "./spatial.js";

it.effect(
	"fails a value outside the contract with a domain error that keeps the schema issue",
	() =>
		Effect.gen(function* () {
			// A peer from another version sends a value this side does not know.
			const error = yield* Effect.flip(
				parseWorldScoutResult(JSON.parse('{ "unexpected": true }'))
			);
			expect(error).toBeInstanceOf(WorldScoutContractError);
			expect(error).toMatchObject({
				code: "invalid_contract",
				message: "The world scout result does not match the World Scout contract.",
				retrySafe: false
			});
			expect(error.cause).toBeDefined();
		})
);
