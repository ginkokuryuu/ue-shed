import { parentPort, workerData } from "node:worker_threads";
import { Effect, Schema } from "effect";
import { sharedIndexNodeLayer } from "./shared-index.js";
import { openJoinedTarget } from "./joined-target-reader.js";
import { columnarTextCorpusQuery } from "./columnar-query.js";
import { snapshotCheck } from "./snapshot-format.js";
import {
	SearchWorkerInput,
	SearchWorkerTask,
	SearchWorkerReply,
	searchWorkerFailure
} from "./search-worker-protocol.js";

const port = parentPort;
if (!port) throw new Error("Game Text search requires its owning worker adapter.");
const reply = (value: SearchWorkerReply) =>
	port.postMessage(Schema.encodeSync(SearchWorkerReply)(value));

// This worker is a Node runtime boundary. Its scope pins the generation until shutdown.
void Effect.runPromise(
	Effect.scoped(
		Effect.gen(function* () {
			const input = yield* Schema.decodeUnknownEffect(SearchWorkerInput)(workerData);
			const joined = yield* openJoinedTarget().pipe(
				Effect.provide(sharedIndexNodeLayer(input.configuration))
			);
			snapshotCheck(
				joined.reader.manifest.generation === input.generation &&
					joined.reader.manifest.active.joined === input.joinedKey,
				"search.worker",
				"The search generation changed before its worker opened it"
			);
			let cancelled: Int32Array | undefined;
			const query = columnarTextCorpusQuery(joined, undefined, undefined, () => {
				if (cancelled && Atomics.load(cancelled, 0)) throw new Error("Search cancelled");
			});
			yield* Effect.callback<void>((resume) => {
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
				reply({ kind: "ready" });
				return Effect.sync(() => {
					port.off("message", message);
					port.off("close", close);
				});
			});
		})
	)
).catch((cause) =>
	reply({ kind: "failed", error: searchWorkerFailure("search.worker.open", cause) })
);
