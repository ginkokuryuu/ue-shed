import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CameraBridgeResponse, readyCameraBridge } from "./camera-authoring-bridge.js";

const decode = Schema.decodeUnknownSync(CameraBridgeResponse);

describe("camera bridge failure codes", () => {
	it("keeps the bridge's specific cause beside the coarse status", async () => {
		const response = decode({
			version: 1,
			status: "stale",
			message: "The editor project or map differs from the requested scope.",
			code: "scope_mismatch"
		});
		await expect(Effect.runPromise(readyCameraBridge(response))).rejects.toMatchObject({
			code: "stale",
			cause: "scope_mismatch"
		});
	});

	it("reads an older bridge's failure without a code", async () => {
		const response = decode({
			version: 1,
			status: "busy",
			message: "Detach the active camera first."
		});
		const error = await Effect.runPromise(Effect.flip(readyCameraBridge(response)));
		expect(error.code).toBe("busy");
		expect(error.cause).toBeUndefined();
	});

	it("rejects a code that is not a bounded snake-case cause", () => {
		expect(() =>
			decode({ version: 1, status: "invalid", message: "x", code: "Not a code" })
		).toThrow();
	});
});
