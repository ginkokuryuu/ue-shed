import { it } from "@effect/vitest";
import { ConfigProvider, Effect } from "effect";
import { expect } from "vitest";
import { refreshCliGameTextIndex, invalidateCliGameTextIndex } from "./game-text-index.js";

for (const operation of ["refresh", "invalidate"] as const) {
	it.effect(`retains the reader configuration issue during ${operation}`, () =>
		Effect.gen(function* () {
			const request = { projectRoot: "/generic-project" };
			const failure = yield* Effect.flip(
				operation === "refresh"
					? refreshCliGameTextIndex(request, undefined)
					: invalidateCliGameTextIndex(request)
			);
			if (failure._tag !== "GameTextIndexError")
				throw new Error("Expected configuration failure");
			expect(failure.operation).toBe("configuration");
			expect(failure.cause).toMatchObject({ _tag: "ConfigError" });
			expect(String(failure.cause)).toContain("UE_SHED_UASSET_TIMEOUT");
			expect(String(failure.cause)).toContain("Expected a valid Duration string");
		}).pipe(
			Effect.provide(
				ConfigProvider.layer(
					ConfigProvider.fromUnknown({
						UE_SHED_UASSET_TIMEOUT: "invalid"
					})
				)
			)
		)
	);
}
