import { describe, expect, it } from "vitest";
import { validateUnrealJsonEscapes } from "./unreal-json.js";

describe("Unreal localization JSON surrogate escapes", () => {
	it.each(["manifest", "archive"] as const)(
		"accepts paired and literal escapes in %s",
		(format) => {
			expect(() => validateUnrealJsonEscapes('"\\uD800\\uDC00"', format)).not.toThrow();
			expect(() => validateUnrealJsonEscapes('"\\\\uD800"', format)).not.toThrow();
			expect(() => validateUnrealJsonEscapes('"\\uDCFF\\uDABC"', format)).toThrow();
		}
	);
	it.each(["\\uD800", "\\uDFFF", "\\uDC00\\uD800", "\\uD800x\\uDC00"])(
		"reports the file and absolute character offset for %s",
		(escape) => {
			try {
				validateUnrealJsonEscapes(
					`{"Text":"${escape}"}`,
					"archive",
					"de/Game.archive",
					1000
				);
				throw new Error("Unreal rejects this escape.");
			} catch (cause) {
				expect(cause).toMatchObject({
					code: "malformed_archive",
					message: expect.stringContaining("de/Game.archive at character offset 1009")
				});
			}
		}
	);
});
