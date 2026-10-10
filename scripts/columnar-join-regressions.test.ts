import { readFile } from "node:fs/promises";
import { Schema } from "effect";
import { expect, it } from "vitest";
import { JoinFuzzInput, compareJoinFuzzInput } from "./columnar-join-fuzz.test-support.ts";
import { withJoinCache } from "./columnar-join.test-support.ts";

for (const name of [
	"empty-source-facets",
	"asset-group-unit-order",
	"excluded-package-order",
	"hidden-source-facets",
	"split-conflicting-findings",
	"split-facets",
	"split-short-findings"
]) {
	it(`${name}: minimized original-event regression through the persisted store`, async () => {
		const input = Schema.decodeUnknownSync(Schema.fromJsonString(JoinFuzzInput))(
			await readFile(
				new URL(`./test-fixtures/columnar-join/${name}.json`, import.meta.url),
				"utf8"
			)
		);
		await withJoinCache(async (cache) => {
			const differences = await compareJoinFuzzInput(input, cache, true);
			expect(differences, JSON.stringify(differences, null, 2)).toEqual([]);
		});
	});
}

it.fails.each(["lone-utf16-source", "lone-utf16-localization"])(
	"STOP: %s must preserve a source containing a lone UTF-16 code unit",
	async (name) => {
		const input = Schema.decodeUnknownSync(Schema.fromJsonString(JoinFuzzInput))(
			await readFile(
				new URL(`./test-fixtures/columnar-join/${name}.json`, import.meta.url),
				"utf8"
			)
		);
		await withJoinCache(async (cache) => {
			const differences = await compareJoinFuzzInput(input, cache, true);
			expect(differences, JSON.stringify(differences, null, 2)).toEqual([]);
		});
	}
);
