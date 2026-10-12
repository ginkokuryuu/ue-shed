import { LocalizationError } from "./schema.js";

/** UE 5.7/5.8 RapidJSON rejects escaped surrogate code units unless they form one pair. */
export function validateUnrealJsonEscapes(
	text: string,
	format: "manifest" | "archive",
	file: string = format,
	baseOffset = 0
): void {
	const escapes = /\\(?:u([a-fA-F0-9]{4})|[\s\S])/gu;
	for (let match = escapes.exec(text); match; match = escapes.exec(text)) {
		if (match[1] === undefined) continue;
		const point = Number.parseInt(match[1], 16);
		if (point < 0xd800 || point > 0xdfff) continue;
		const next = text.slice(escapes.lastIndex, escapes.lastIndex + 6);
		if (point <= 0xdbff && /^\\u[dD][c-fC-F][a-fA-F0-9]{2}$/u.test(next)) {
			escapes.lastIndex += 6;
			continue;
		}
		throw new LocalizationError({
			code: format === "manifest" ? "malformed_manifest" : "malformed_archive",
			message: `${file} at character offset ${baseOffset + match.index}: escaped unpaired UTF-16 surrogate; Unreal Engine 5.7 and 5.8 cannot load this file either.`,
			recovery: "Repair the escaped surrogate or regenerate the file through Unreal."
		});
	}
}
