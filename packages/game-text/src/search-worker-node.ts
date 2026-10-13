import { existsSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { Effect, Metric, Schema } from "effect";
import {
	SearchWorkerInput,
	SearchWorkerReply,
	searchWorkerFailure
} from "./search-worker-protocol.js";
import {
	TextCorpusSearchRequest as TextCorpusSearchRequestSchema,
	type TextCorpusSearchPage,
	type TextCorpusSearchRequest
} from "./schema.js";
import type { SnapshotFormatError } from "./snapshot-format.js";
import { SnapshotStoreError } from "./snapshot-store.js";

type Failure = SnapshotStoreError | SnapshotFormatError;
const completed = Metric.counter("game_text.index.worker_searches_completed");
const started = Metric.counter("game_text.index.search_workers_started");
const stopped = Metric.counter("game_text.index.search_workers_stopped");
const retirementDuration = Metric.histogram("game_text.index.search_worker_retirement_ms", {
	boundaries: [1, 10, 100, 1000, 5000, 30000]
});
type Pending = {
	readonly cancelled: Int32Array;
	readonly lane: string;
	readonly selection: string;
	readonly resolve: (page: TextCorpusSearchPage) => void;
	readonly reject: (cause: Failure) => void;
};
function launch(input: SearchWorkerInput) {
	const compiled = new URL("./search-worker.js", import.meta.url);
	if (existsSync(compiled)) return new Worker(compiled, { workerData: input });
	const source = new URL("./search-worker.ts", import.meta.url);
	return new Worker(
		`import("tsx/esm/api").then(async ({ register }) => { register(); await import(${JSON.stringify(source.href)}); });`,
		{ eval: true, workerData: input }
	);
}

/** A scope owns the worker and its separately pinned reader. Replacing a search can cancel
 * running scans through shared memory, without waiting for the worker's event loop. */
export const makeGameTextSearchWorkerResource = Effect.fn("GameTextIndex.searchWorker")(function* (
	input: SearchWorkerInput,
	options: { readonly latestOnly?: boolean } = {}
) {
	const boundary = yield* Schema.decodeUnknownEffect(SearchWorkerInput)(input).pipe(
		Effect.mapError((cause) => searchWorkerFailure("search.worker.input", cause))
	);
	const worker = yield* Effect.acquireRelease(
		Effect.try({
			try: () => launch(boundary),
			catch: (cause) => searchWorkerFailure("search.worker.start", cause)
		}),
		(worker) =>
			Effect.gen(function* () {
				const start = performance.now();
				yield* Effect.promise(() => worker.terminate());
				yield* Metric.update(stopped, 1);
				yield* Metric.update(retirementDuration, performance.now() - start);
			})
	);
	yield* Metric.update(started, 1);
	const pending = new Map<number, Pending>();
	let sequence = 0;
	let failed: Failure | undefined;
	let readyResolve: () => void = () => {};
	let readyReject: (cause: Failure) => void = () => {};
	const ready = new Promise<void>((resolve, reject) => {
		readyResolve = resolve;
		readyReject = reject;
	});
	const fail = (cause: unknown) => {
		failed = searchWorkerFailure("search.worker", cause);
		readyReject(failed);
		for (const task of pending.values()) task.reject(failed);
		pending.clear();
	};
	worker.on("error", fail);
	worker.on("exit", (code) => fail(new Error(`Game Text search worker exited (${code}).`)));
	worker.on("message", (raw: typeof SearchWorkerReply.Encoded) => {
		try {
			const reply = Schema.decodeUnknownSync(SearchWorkerReply)(raw);
			if (reply.kind === "ready") {
				readyResolve();
				return;
			}
			if (reply.kind === "failed" && reply.id === undefined) {
				fail(reply.error);
				return;
			}
			const task = reply.id === undefined ? undefined : pending.get(reply.id);
			if (!task) return;
			pending.delete(reply.id!);
			if (reply.kind === "result") task.resolve(reply.page);
			else
				task.reject(
					reply.kind === "failed"
						? reply.error
						: searchWorkerFailure("search.superseded", "The search was replaced.")
				);
		} catch (cause) {
			fail(cause);
		}
	});
	yield* Effect.tryPromise({
		try: () => ready,
		catch: (cause) => searchWorkerFailure("search.worker.open", cause)
	}).pipe(
		Effect.timeout("30 seconds"),
		Effect.mapError((cause) => searchWorkerFailure("search.worker.open", cause))
	);
	const search = Effect.fn("GameTextIndex.searchWorker.search")(
		(request: TextCorpusSearchRequest) =>
			Schema.decodeUnknownEffect(TextCorpusSearchRequestSchema)(request).pipe(
				Effect.mapError((cause) => searchWorkerFailure("search.worker.request", cause)),
				Effect.flatMap((validated) =>
					Effect.tryPromise({
						try: (signal) =>
							new Promise<TextCorpusSearchPage>((resolve, reject) => {
								if (failed) {
									reject(failed);
									return;
								}
								const {
									cursor: _cursor,
									localizationCursor: _localizationCursor,
									pageSize: _pageSize,
									openGroup: _openGroup,
									...filters
								} = validated;
								const selection = JSON.stringify(filters);
								const lane = JSON.stringify([validated.openGroup]);
								if (options.latestOnly) {
									for (const [id, task] of pending) {
										// Different open groups belong to independent page requests. The
										// main list also retires group requests from an older selection.
										if (
											task.lane !== lane &&
											(validated.openGroup !== undefined ||
												task.selection === selection)
										)
											continue;
										Atomics.store(task.cancelled, 0, 1);
										task.reject(
											searchWorkerFailure(
												"search.superseded",
												"The search was replaced."
											)
										);
										pending.delete(id);
									}
								}
								const id = ++sequence;
								const cancelled = new Int32Array(new SharedArrayBuffer(4));
								const abort = () => {
									clean();
									Atomics.store(cancelled, 0, 1);
									pending.delete(id);
									reject(
										searchWorkerFailure(
											"search.superseded",
											"The search was cancelled."
										)
									);
								};
								const clean = () => signal.removeEventListener("abort", abort);
								pending.set(id, {
									cancelled,
									lane,
									selection,
									resolve: (page) => {
										clean();
										resolve(page);
									},
									reject: (cause) => {
										clean();
										reject(cause);
									}
								});
								signal.addEventListener("abort", abort, { once: true });
								if (signal.aborted) {
									abort();
									return;
								}
								try {
									worker.postMessage({
										id,
										request: validated,
										cancelled: cancelled.buffer
									});
								} catch (cause) {
									pending.delete(id);
									clean();
									reject(cause);
								}
							}),
						catch: (cause) => searchWorkerFailure("search.worker.query", cause)
					})
				),
				Effect.catchIf(
					(cause) =>
						cause instanceof SnapshotStoreError &&
						cause.operation === "search.superseded",
					() => Effect.interrupt
				),
				Effect.timeout("30 seconds"),
				Effect.mapError((cause) => searchWorkerFailure("search.worker.query", cause)),
				Effect.tap((page) =>
					Effect.all([
						Metric.update(completed, 1),
						Effect.annotateCurrentSpan({ "game_text.index.matching_lines": page.total })
					])
				)
			)
	);
	return { search, healthy: () => failed === undefined };
});

/** Compatibility search adapter; resource health is owned by the index steps' worker pool. */
export const makeGameTextSearchWorker = Effect.fn("GameTextIndex.searchWorker.adapter")(function* (
	input: SearchWorkerInput,
	options: { readonly latestOnly?: boolean } = {}
) {
	return (yield* makeGameTextSearchWorkerResource(input, options)).search;
});
