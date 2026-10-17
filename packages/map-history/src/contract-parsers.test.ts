import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vitest";
import { MapHistoryContractError, parseMapHistoryQuery } from "./schema.js";

it.effect(
	"fails a value outside the contract with a domain error that keeps the schema issue",
	() =>
		Effect.gen(function* () {
			// A peer from another version sends a value this side does not know.
			const error = yield* Effect.flip(
				parseMapHistoryQuery(JSON.parse('{ "unexpected": true }'))
			);
			expect(error).toBeInstanceOf(MapHistoryContractError);
			expect(error).toMatchObject({
				code: "invalid_contract",
				message: "The map history query does not match the map history contract.",
				retrySafe: false
			});
			expect(error.cause).toBeDefined();
		})
);
