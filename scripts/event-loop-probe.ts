/** Event-loop lag probe with CPU-profile attribution. Internal measurement tool, never a package
 * export. Gaps come from a fixed-interval timer; the in-process V8 profile is aligned with a
 * busy marker so each long gap can be attributed to the package functions that ran inside it.
 */
import { Session } from "node:inspector/promises";
import { findSourceMap } from "node:module";
import { relative } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Option, Tracer, type Exit } from "effect";

export interface EventLoopGap {
	readonly startMs: number;
	readonly endMs: number;
	readonly ms: number;
	/** Stage when the blocked stretch began and when the timer finally ran. */
	readonly startStage: string;
	readonly endStage: string;
	/** Stage active for most of the stretch; per-stage statistics use this stage. */
	readonly stage: string;
}

export interface StageSummary {
	readonly stage: string;
	readonly wallMs: number;
	readonly ticks: number;
	readonly maxGapMs: number;
	readonly p99GapMs: number;
	readonly gapsOver100Ms: number;
	/** Sum of tick lateness beyond the interval; approximates time the loop was unavailable. */
	readonly blockedMs: number;
}

export interface EventLoopProbe {
	stage(name: string): void;
	readonly current: () => string;
	stop(): {
		readonly gaps: readonly EventLoopGap[];
		readonly stages: readonly StageSummary[];
		readonly histogram: {
			readonly minMs: number;
			readonly meanMs: number;
			readonly p50Ms: number;
			readonly p90Ms: number;
			readonly p99Ms: number;
			readonly maxMs: number;
		};
		readonly maxTickMs: number;
	};
}

const percentile = (values: readonly number[], fraction: number) => {
	if (!values.length) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]!;
};

export function startEventLoopProbe(options: {
	readonly intervalMs: number;
	readonly recordMs: number;
}): EventLoopProbe {
	const histogram = monitorEventLoopDelay({ resolution: 10 });
	histogram.enable();
	let stage = "start",
		last = performance.now(),
		lastStage = stage,
		enteredAt = last,
		maxTickMs = 0;
	const gaps: EventLoopGap[] = [];
	const ticks = new Map<string, number[]>();
	const wall = new Map<string, number>();
	let transitions: { readonly at: number; readonly stage: string }[] = [];
	const dominant = (from: number, to: number) => {
		const overlap = new Map<string, number>();
		let at = from,
			current = lastStage;
		for (const transition of [...transitions, { at: to, stage }]) {
			overlap.set(current, (overlap.get(current) ?? 0) + transition.at - at);
			at = transition.at;
			current = transition.stage;
		}
		return [...overlap].sort((left, right) => right[1] - left[1])[0]![0];
	};
	const timer = setInterval(() => {
		const now = performance.now(),
			ms = now - last,
			owner = transitions.length ? dominant(last, now) : stage;
		maxTickMs = Math.max(maxTickMs, ms);
		const values = ticks.get(owner) ?? [];
		values.push(ms);
		ticks.set(owner, values);
		if (ms >= options.recordMs)
			gaps.push({
				startMs: last,
				endMs: now,
				ms,
				startStage: lastStage,
				endStage: stage,
				stage: owner
			});
		last = now;
		lastStage = stage;
		transitions = [];
	}, options.intervalMs);
	return {
		stage(name) {
			if (name === stage) return;
			const now = performance.now();
			wall.set(stage, (wall.get(stage) ?? 0) + now - enteredAt);
			transitions.push({ at: now, stage: name });
			stage = name;
			enteredAt = now;
		},
		current: () => stage,
		stop() {
			clearInterval(timer);
			histogram.disable();
			wall.set(stage, (wall.get(stage) ?? 0) + performance.now() - enteredAt);
			const stages = [...new Set([...wall.keys(), ...ticks.keys()])].map((name) => {
				const values = ticks.get(name) ?? [];
				return {
					stage: name,
					wallMs: wall.get(name) ?? 0,
					ticks: values.length,
					maxGapMs: Math.max(0, ...values),
					p99GapMs: percentile(values, 0.99),
					gapsOver100Ms: values.filter((value) => value >= 100).length,
					blockedMs: values.reduce(
						(sum, value) => sum + Math.max(0, value - options.intervalMs),
						0
					)
				};
			});
			const ms = (value: number) => value / 1e6;
			return {
				gaps,
				stages,
				maxTickMs,
				histogram: {
					minMs: ms(histogram.min),
					meanMs: ms(histogram.mean),
					p50Ms: ms(histogram.percentile(50)),
					p90Ms: ms(histogram.percentile(90)),
					p99Ms: ms(histogram.percentile(99)),
					maxMs: ms(histogram.max)
				}
			};
		}
	};
}

interface ProfileNode {
	readonly id: number;
	readonly callFrame: {
		readonly functionName: string;
		readonly url: string;
		readonly lineNumber: number;
		readonly columnNumber: number;
	};
	readonly children?: readonly number[];
}
export interface CpuProfile {
	readonly nodes: readonly ProfileNode[];
	readonly startTime: number;
	readonly endTime: number;
	readonly samples: readonly number[];
	readonly timeDeltas: readonly number[];
}

/** Recognisable synchronous work used only to align profile time with `performance.now()`. */
function eventLoopProbeMarker(ms: number) {
	const end = performance.now() + ms;
	let spins = 0;
	while (performance.now() < end) spins++;
	return spins;
}

export async function startCpuProfile(samplingIntervalUs: number) {
	const session = new Session();
	session.connect();
	await session.post("Profiler.enable");
	await session.post("Profiler.setSamplingInterval", { interval: samplingIntervalUs });
	await session.post("Profiler.start");
	const markerMs = performance.now();
	eventLoopProbeMarker(30);
	return {
		markerMs,
		stop: async (): Promise<CpuProfile> => {
			const { profile } = await session.post("Profiler.stop");
			session.disconnect();
			// SAFETY: Profiler.stop returns a V8 CPU profile; only CpuProfile's fields are read.
			return profile as CpuProfile;
		}
	};
}

export interface GapAttribution {
	readonly gap: EventLoopGap;
	readonly sampledMs: number;
	readonly gcMs: number;
	/** Innermost repository frame on each sampled stack, with its repository caller chain. */
	readonly owners: readonly { readonly frame: string; readonly ms: number; chain: string }[];
	/** Leaf frames, including V8 builtins such as JSON.parse or Array.prototype.sort. */
	readonly leaves: readonly { readonly frame: string; readonly ms: number }[];
}

/** Maps compiled dist frames to TypeScript sources through the emitted source maps. */
function frameLocator(repositoryRoot: string) {
	const cache = new Map<string, string>();
	return (frame: ProfileNode["callFrame"]) => {
		const key = `${frame.url}:${frame.lineNumber}:${frame.columnNumber}:${frame.functionName}`;
		const cached = cache.get(key);
		if (cached !== undefined) return cached;
		const name = frame.functionName || "(anonymous)";
		let location = frame.url ? frame.url : "";
		if (frame.url.startsWith("file:")) {
			const path = fileURLToPath(frame.url);
			let file = path,
				line = frame.lineNumber + 1;
			try {
				const origin = (findSourceMap(path) ?? findSourceMap(frame.url))?.findOrigin(
					frame.lineNumber + 1,
					frame.columnNumber + 1
				);
				if (origin && "fileName" in origin) {
					file = origin.fileName.startsWith("file:")
						? fileURLToPath(origin.fileName)
						: origin.fileName;
					line = origin.lineNumber;
				}
			} catch {
				// Unmapped frames keep their compiled location.
			}
			location = `${relative(repositoryRoot, file).replaceAll("\\", "/")}:${line}`;
		}
		const value = location ? `${name} ${location}` : name;
		cache.set(key, value);
		return value;
	};
}

const repositoryFrame = (url: string) =>
	url.startsWith("file:") && !url.includes("/node_modules/") && url.includes("/packages/");

export function attributeGaps(options: {
	readonly profile: CpuProfile;
	readonly markerMs: number;
	readonly gaps: readonly EventLoopGap[];
	readonly repositoryRoot: string;
	readonly top?: number;
}) {
	const { profile } = options;
	const byId = new Map(profile.nodes.map((node) => [node.id, node]));
	const parent = new Map<number, number>();
	for (const node of profile.nodes)
		for (const child of node.children ?? []) parent.set(child, node.id);
	const stack = (id: number) => {
		const frames: ProfileNode[] = [];
		for (let current: number | undefined = id; current !== undefined; ) {
			const node = byId.get(current)!;
			frames.push(node);
			current = parent.get(current);
		}
		return frames;
	};
	const times: number[] = [];
	let time = profile.startTime;
	for (const delta of profile.timeDeltas) times.push((time += delta));
	// Align on the first sample inside the marker function.
	let markerUs: number | undefined;
	for (let index = 0; index < profile.samples.length; index++)
		if (
			stack(profile.samples[index]!).some(
				(node) => node.callFrame.functionName === "eventLoopProbeMarker"
			)
		) {
			markerUs = times[index]!;
			break;
		}
	if (markerUs === undefined) throw new Error("The profile does not contain the marker.");
	const offset = options.markerMs - markerUs / 1000;
	const locate = frameLocator(options.repositoryRoot);
	const top = options.top ?? 5;
	const sampleMs = (index: number) =>
		index + 1 < times.length ? (times[index + 1]! - times[index]!) / 1000 : 0;
	const gaps = options.gaps.map((gap) => {
		const owners = new Map<string, { ms: number; chains: Map<string, number> }>();
		const leaves = new Map<string, number>();
		let sampledMs = 0,
			gcMs = 0;
		for (let index = 0; index < times.length; index++) {
			const at = times[index]! / 1000 + offset;
			if (at < gap.startMs || at > gap.endMs) continue;
			const frames = stack(profile.samples[index]!);
			const leaf = frames[0]!.callFrame;
			if (leaf.functionName === "(idle)") continue;
			const ms = sampleMs(index);
			sampledMs += ms;
			if (leaf.functionName === "(garbage collector)") gcMs += ms;
			const leafKey = locate(leaf);
			leaves.set(leafKey, (leaves.get(leafKey) ?? 0) + ms);
			const repository = frames.filter((node) => repositoryFrame(node.callFrame.url));
			const owner = repository[0] ? locate(repository[0].callFrame) : `[${leafKey}]`;
			const chain = repository
				.slice(1, 9)
				.map((node) => locate(node.callFrame))
				.join(" < ");
			const entry = owners.get(owner) ?? { ms: 0, chains: new Map() };
			entry.ms += ms;
			entry.chains.set(chain, (entry.chains.get(chain) ?? 0) + ms);
			owners.set(owner, entry);
		}
		return {
			gap,
			sampledMs,
			gcMs,
			owners: [...owners]
				.sort((left, right) => right[1].ms - left[1].ms)
				.slice(0, top)
				.map(([frame, value]) => ({
					frame,
					ms: value.ms,
					chain: [...value.chains].sort((left, right) => right[1] - left[1])[0]![0]
				})),
			leaves: [...leaves]
				.sort((left, right) => right[1] - left[1])
				.slice(0, top)
				.map(([frame, ms]) => ({ frame, ms }))
		} satisfies GapAttribution;
	});
	return { alignmentMs: offset, gaps };
}

/** Whole-run inclusive time per repository function, restricted to samples inside long gaps. */
export function blockingOwners(attributions: readonly GapAttribution[]) {
	const totals = new Map<string, { ms: number; gaps: number; maxGapMs: number }>();
	for (const attribution of attributions)
		for (const owner of attribution.owners) {
			const entry = totals.get(owner.frame) ?? { ms: 0, gaps: 0, maxGapMs: 0 };
			entry.ms += owner.ms;
			entry.gaps++;
			entry.maxGapMs = Math.max(entry.maxGapMs, attribution.gap.ms);
			totals.set(owner.frame, entry);
		}
	return [...totals]
		.sort((left, right) => right[1].ms - left[1].ms)
		.map(([frame, value]) => ({ frame, ...value }));
}

export interface RecordedSpan {
	readonly name: string;
	readonly depth: number;
	readonly parent: number | undefined;
	readonly startMs: number;
	endMs: number | undefined;
}

/** Records Effect span intervals on the probe clock. Async continuations lose their callers in
 * CPU stacks; the innermost span that covers a gap still names the operation responsible.
 */
export function spanRecorder() {
	const spans: RecordedSpan[] = [];
	const indexes = new WeakMap<Tracer.AnySpan, number>();
	class RecordedNativeSpan extends Tracer.NativeSpan {
		readonly index: number;
		constructor(options: ConstructorParameters<typeof Tracer.NativeSpan>[0]) {
			super(options);
			const parent = Option.getOrUndefined(options.parent);
			const parentIndex = parent === undefined ? undefined : indexes.get(parent);
			this.index = spans.length;
			indexes.set(this, this.index);
			spans.push({
				name: options.name,
				depth: parentIndex === undefined ? 0 : spans[parentIndex]!.depth + 1,
				parent: parentIndex,
				startMs: performance.now(),
				endMs: undefined
			});
		}
		override end(endTime: bigint, exit: Exit.Exit<unknown, unknown>) {
			super.end(endTime, exit);
			spans[this.index]!.endMs = performance.now();
		}
	}
	const tracer = Tracer.make({ span: (options) => new RecordedNativeSpan(options) });
	return { tracer, spans };
}

/** Innermost span covering most of each gap, its ancestors, and its busiest overlapping children. */
export function attributeSpans(
	spans: readonly RecordedSpan[],
	gaps: readonly EventLoopGap[],
	untilMs: number
) {
	const sorted = spans
		.map((span, index) => ({ span, index }))
		.sort((left, right) => left.span.startMs - right.span.startMs);
	return gaps.map((gap) => {
		const overlapping = [];
		for (const { span, index } of sorted) {
			if (span.startMs > gap.endMs) break;
			const end = span.endMs ?? untilMs;
			const overlap = Math.min(end, gap.endMs) - Math.max(span.startMs, gap.startMs);
			if (overlap > 0) overlapping.push({ span, index, overlap });
		}
		const covering = overlapping
			.filter((item) => item.overlap >= gap.ms * 0.5)
			.sort((left, right) => right.span.depth - left.span.depth)[0];
		const path: string[] = [];
		for (
			let index: number | undefined = covering?.index;
			index !== undefined;
			index = spans[index]!.parent
		)
			path.unshift(spans[index]!.name);
		const children = new Map<string, number>();
		for (const item of overlapping)
			if (covering && item.span.parent === covering.index)
				children.set(item.span.name, (children.get(item.span.name) ?? 0) + item.overlap);
		return {
			ms: gap.ms,
			stage: gap.stage,
			span: path.join(" > "),
			children: [...children]
				.sort((left, right) => right[1] - left[1])
				.slice(0, 4)
				.map(([name, ms]) => ({ name, ms }))
		};
	});
}
