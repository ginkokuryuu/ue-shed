import { performance } from "node:perf_hooks";
import { receiveMessageOnPort, type MessagePort } from "node:worker_threads";
import { Schema } from "effect";

/**
 * Synchronous calls from a host thread to a worker. The host posts on a dedicated port and waits
 * on a shared counter; the worker posts its reply, then moves the counter and wakes the host.
 */
export interface SyncCallChannel {
	readonly port: MessagePort;
	readonly signal: Int32Array;
}

/**
 * Blocks this thread until the reply to call `id` arrives, decoded by `reply`. Replies to
 * earlier calls that timed out are dropped; their callers have already failed.
 */
export function receiveSyncReply<S extends Schema.ConstraintDecoder<unknown>>(
	calls: SyncCallChannel,
	reply: S,
	idOf: (reply: S["Type"]) => number,
	id: number,
	timeoutMs: number,
	timedOut: () => Error
): S["Type"] {
	const deadline = performance.now() + timeoutMs;
	for (;;) {
		// Read the counter before looking for the reply, so a reply posted in between moves it.
		const seen = Atomics.load(calls.signal, 0);
		const received = receiveMessageOnPort(calls.port);
		if (received) {
			const decoded = Schema.decodeUnknownSync(reply)(received.message);
			if (idOf(decoded) === id) return decoded;
			continue;
		}
		const remaining = deadline - performance.now();
		if (remaining <= 0) throw timedOut();
		Atomics.wait(calls.signal, 0, seen, remaining);
	}
}

/** The worker's side: posts an encoded reply, then wakes the host waiting for it. */
export function postSyncReply<A>(port: MessagePort, signal: Int32Array, encoded: A) {
	port.postMessage(encoded);
	// A counter, not a flag: the host waits until it moves past the value it saw before asking.
	Atomics.add(signal, 0, 1);
	Atomics.notify(signal, 0);
}
