import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { encodeWtf8, decodeWtf8 } from "../packages/game-text/src/wtf8.ts";

const encoder = new TextEncoder(),
	decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const measure = (run: () => string | Uint8Array) => {
	for (let row = 0; row < 100; row++) run();
	const samples: number[] = [];
	for (let round = 0; round < 21; round++) {
		const started = performance.now();
		for (let row = 0; row < 200; row++) run();
		samples.push((performance.now() - started) / 200);
	}
	return samples.sort((a, b) => a - b)[10]!;
};
const results = [64, 4096, 256 * 1024].map((length) => {
	let value = "mirava café 日本語 😀\u2028".repeat(Math.ceil(length / 20)).slice(0, length - 2);
	if (!value.isWellFormed()) value = value.slice(0, -1);
	const bytes = encoder.encode(value);
	if (decodeWtf8(bytes) !== decoder.decode(bytes)) throw new Error("Decoder differs.");
	return {
		codeUnits: value.length,
		bytes: bytes.length,
		utf8EncodeMs: measure(() => encoder.encode(value)),
		wtf8EncodeMs: measure(() => encodeWtf8(value)),
		utf8DecodeMs: measure(() => decoder.decode(bytes)),
		wtf8DecodeMs: measure(() => decodeWtf8(bytes))
	};
});
const batch = (count: number, decode: (bytes: Uint8Array) => string) => {
	const bytes = encoder.encode("mirava café 日本語 😀\u2028".repeat(3));
	return measure(() => {
		let value = "";
		for (let row = 0; row < count; row++) value = decode(bytes);
		return value;
	});
};
const batches = [50, 10000].map((strings) => ({
	strings,
	utf8Ms: batch(strings, (bytes) => decoder.decode(bytes)),
	wtf8Ms: batch(strings, decodeWtf8)
}));
const output = process.argv[2] ?? "test-results/codex/phase6-wtf8-fast-path.json";
await mkdir(dirname(output), { recursive: true });
await writeFile(
	output,
	JSON.stringify(
		{ node: process.version, samples: 21, iterations: 200, results, batches },
		null,
		"\t"
	) + "\n"
);
console.log(JSON.stringify({ results, batches }));
