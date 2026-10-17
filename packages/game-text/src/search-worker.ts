import { MessagePort, parentPort, workerData } from "node:worker_threads";
import { Effect, Schema } from "effect";
import { sharedIndexNodeLayer } from "./shared-index.js";
import { openJoinedTarget } from "./joined-target-reader.js";
import { columnarTextCorpusQuery, type ColumnarTextCorpusQuery } from "./columnar-query.js";
import { snapshotCheck } from "./snapshot-format.js";
import {
	SearchWorkerInput,
	SearchWorkerTask,
	SearchWorkerReply,
	SearchWorkerCall,
	SearchWorkerCallFailure,
	SearchWorkerCallReply,
	searchWorkerCallValues,
	searchWorkerFailure
} from "./search-worker-protocol.js";
import { GameTextLocalizationError } from "./localization-schema.js";
import { postSyncReply } from "./worker-calls.js";

const port = parentPort;
if (!port) throw new Error("Game Text search requires its owning worker adapter.");
const reply = (value: SearchWorkerReply) =>
	port.postMessage(Schema.encodeSync(SearchWorkerReply)(value));
const WorkerData = Schema.Struct({
	input: SearchWorkerInput,
	calls: Schema.instanceOf(MessagePort),
	signal: Schema.instanceOf(SharedArrayBuffer)
});

function callReply(
	query: ColumnarTextCorpusQuery,
	call: SearchWorkerCall
): typeof SearchWorkerCallReply.Encoded {
	const values = searchWorkerCallValues;
	const value = (() => {
		switch (call.method) {
			case "search":
				return Schema.encodeSync(values.search)(query.search(call.request));
			case "focus":
				return Schema.encodeSync(values.focus)(query.focus(call.request));
			case "localizationFocus":
				return Schema.encodeSync(values.localizationFocus)(
					query.localizationFocus(call.lineId)
				);
			case "localizationLines":
				return Schema.encodeSync(values.localizationLines)(
					query.localizationLines(call.request)
				);
			case "localizationRows":
				// Cloned on post; the query's cached array stays with the worker.
				return query.localizationRows(call.request);
			case "export":
				return Schema.encodeSync(values.export)(query.export(call.request));
		}
	})();
	return { kind: "value", id: call.id, value };
}

/** Answers one synchronous call from the host, then wakes the host's wait on `signal`. */
function answer(
	query: ColumnarTextCorpusQuery,
	calls: MessagePort,
	signal: Int32Array,
	raw: typeof SearchWorkerCall.Encoded
) {
	let response: typeof SearchWorkerCallReply.Encoded;
	let id = 0;
	try {
		const call = Schema.decodeUnknownSync(SearchWorkerCall)(raw);
		id = call.id;
		response = callReply(query, call);
	} catch (cause) {
		const error = Schema.is(GameTextLocalizationError)(cause)
			? cause
			: searchWorkerFailure("search.worker.call", cause);
		response = {
			kind: "failed",
			id,
			error: Schema.encodeSync(SearchWorkerCallFailure)(error)
		};
	}
	postSyncReply(calls, signal, response);
}

// This worker is a Node runtime boundary. Its scope pins the generation until shutdown.
void Effect.runPromise(
	Effect.scoped(
		Effect.gen(function* () {
			const data = yield* Schema.decodeUnknownEffect(WorkerData)(workerData);
			const input = data.input;
			const joined = yield* openJoinedTarget().pipe(
				Effect.provide(sharedIndexNodeLayer(input.configuration))
			);
			snapshotCheck(
				joined.reader.manifest.generation === input.generation &&
					joined.reader.manifest.active.joined === input.joinedKey,
				"search.worker",
				"The search generation changed before its worker opened it"
			);
			snapshotCheck(data.signal.byteLength === 4, "search.worker", "Invalid call flag");
			let cancelled: Int32Array | undefined;
			// The only preparation of this generation's query: the host borrows it through calls.
			const query = columnarTextCorpusQuery(joined, undefined, undefined, () => {
				if (cancelled && Atomics.load(cancelled, 0)) throw new Error("Search cancelled");
			});
			const signal = new Int32Array(data.signal);
			yield* Effect.callback<void>((resume) => {
				const call = (raw: typeof SearchWorkerCall.Encoded) =>
					answer(query, data.calls, signal, raw);
				const message = (raw: typeof SearchWorkerTask.Encoded) => {
					let id: number | undefined;
					try {
						const task = Schema.decodeUnknownSync(SearchWorkerTask)(raw);
						id = task.id;
						snapshotCheck(
							task.cancelled.byteLength === 4,
							"search.worker",
							"Invalid cancellation flag"
						);
						cancelled = new Int32Array(task.cancelled);
						if (Atomics.load(cancelled, 0)) {
							reply({ kind: "cancelled", id });
							return;
						}
						const page = query.search(task.request);
						reply(
							Atomics.load(cancelled, 0)
								? { kind: "cancelled", id }
								: { kind: "result", id, page }
						);
					} catch (cause) {
						if (id !== undefined && cancelled && Atomics.load(cancelled, 0))
							reply({ kind: "cancelled", id });
						else {
							const error = searchWorkerFailure("search.worker", cause);
							reply(
								id === undefined
									? { kind: "failed", error }
									: { kind: "failed", id, error }
							);
						}
					} finally {
						cancelled = undefined;
					}
				};
				const close = () => resume(Effect.void);
				port.on("message", message);
				port.once("close", close);
				data.calls.on("message", call);
				reply({ kind: "ready", summary: query.summary() });
				return Effect.sync(() => {
					port.off("message", message);
					port.off("close", close);
					data.calls.off("message", call);
					data.calls.close();
				});
			});
		})
	)
).catch((cause) =>
	reply({ kind: "failed", error: searchWorkerFailure("search.worker.open", cause) })
);
