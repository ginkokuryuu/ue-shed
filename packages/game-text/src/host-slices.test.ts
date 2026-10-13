import { Effect } from "effect";
import { expect, it } from "vitest";
import { HostSliceClock, sortRowsInSlices } from "./host-slices.js";

it("sorts rows exactly like a stable native sort, including ties", async () => {
	let seed = 7;
	const random = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0);
	for (const count of [0, 1, 17, 4096, 4097, 20_000, 70_001]) {
		const keys = Uint32Array.from({ length: count }, () => random() % 997);
		const compare = (left: number, right: number) => keys[left]! - keys[right]!;
		const expected = Uint32Array.from({ length: count }, (_, row) => row).sort(compare);
		// A zero budget yields at every opportunity, exercising every resume point.
		const actual = await Effect.runPromise(
			sortRowsInSlices(
				Uint32Array.from({ length: count }, (_, row) => row),
				compare,
				new HostSliceClock(0, count > 5000 ? 4096 : 1),
				1000
			)
		);
		expect(Array.from(actual)).toEqual(Array.from(expected));
	}
});
