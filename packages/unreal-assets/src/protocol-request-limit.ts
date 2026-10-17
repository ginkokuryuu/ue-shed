/**
 * Largest request frame the native reader accepts, trailing newline included. Mirrors
 * `MAX_REQUEST_BYTES` in `crates/uasset-io/src/protocol_adapter.rs`; a larger request fails with a
 * `contract` error before the reader starts.
 */
export const MAX_PROTOCOL_REQUEST_BYTES = 4 * 1024 * 1024;

/** Bytes each batch leaves free for the rest of the request: kind, options and project root. */
const REQUEST_ENVELOPE_RESERVE_BYTES = 64 * 1024;

/** Default path budget of one request, after the envelope reserve. */
export const MAX_PROTOCOL_PATH_BYTES = MAX_PROTOCOL_REQUEST_BYTES - REQUEST_ENVELOPE_RESERVE_BYTES;

/**
 * Split package paths into consecutive batches whose JSON-encoded path lists each fit in one native
 * reader request. Order is preserved and every path appears in exactly one batch. A single path
 * larger than the budget gets a batch of its own, which the reader then rejects as too large.
 */
export function batchProtocolPaths(
	paths: readonly string[],
	maximumPathBytes: number = MAX_PROTOCOL_PATH_BYTES
): readonly (readonly string[])[] {
	const batches: string[][] = [];
	let batch: string[] = [];
	let bytes = 0;
	for (const path of paths) {
		// A JSON string literal plus the separating comma.
		const size = Buffer.byteLength(JSON.stringify(path), "utf8") + 1;
		if (batch.length > 0 && bytes + size > maximumPathBytes) {
			batches.push(batch);
			batch = [];
			bytes = 0;
		}
		batch.push(path);
		bytes += size;
	}
	if (batch.length > 0) batches.push(batch);
	return batches;
}
