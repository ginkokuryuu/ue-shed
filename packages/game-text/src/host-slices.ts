import { performance } from "node:perf_hooks";
import { Effect } from "effect";

/** Host-thread work runs in short slices so a server host keeps answering while an index builds.
 * The clock reads time only every `stride` steps; an expired slice is ended by yielding to the
 * event loop, either through the Effect scheduler or `nextMacrotask` in promise code.
 */
export class HostSliceClock {
	private started = performance.now();
	private steps = 0;
	constructor(
		private readonly budgetMs = 16,
		private readonly stride = 1024
	) {}
	/** Counts one cheap unit of work and reports whether the current slice is spent. */
	step(): boolean {
		if (++this.steps < this.stride) return false;
		return this.expired();
	}
	/** Reports whether the current slice is spent, after one expensive unit of work. */
	expired(): boolean {
		this.steps = 0;
		const now = performance.now();
		if (now - this.started < this.budgetMs) return false;
		this.started = now;
		return true;
	}
}

/** Promise continuations are microtasks; only a macrotask lets timers and I/O callbacks run. */
export const nextMacrotask = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Stable sort of row indices that yields between bounded chunk sorts and merge slices.
 * The result equals a stable `values.sort(compare)` for any consistent comparator.
 */
export const sortRowsInSlices = (
	values: Uint32Array,
	compare: (left: number, right: number) => number,
	clock = new HostSliceClock(),
	chunk = 4096
) =>
	Effect.gen(function* () {
		const count = values.length;
		for (let start = 0; start < count; start += chunk) {
			values.subarray(start, Math.min(count, start + chunk)).sort(compare);
			if (clock.expired()) yield* Effect.yieldNow;
		}
		if (count <= chunk) return values;
		let source: Uint32Array = values,
			target: Uint32Array = new Uint32Array(count);
		for (let width = chunk; width < count; width *= 2) {
			for (let left = 0; left < count; left += width * 2) {
				const middle = Math.min(count, left + width),
					right = Math.min(count, left + width * 2);
				let a = left,
					b = middle,
					out = left;
				while (a < middle && b < right) {
					// Ties take the left run, which keeps the merge stable.
					target[out++] =
						compare(source[b]!, source[a]!) < 0 ? source[b++]! : source[a++]!;
					if (clock.step()) yield* Effect.yieldNow;
				}
				target.set(source.subarray(a, middle), out);
				target.set(source.subarray(b, right), out + middle - a);
			}
			[source, target] = [target, source];
		}
		if (source !== values) values.set(source);
		return values;
	});
