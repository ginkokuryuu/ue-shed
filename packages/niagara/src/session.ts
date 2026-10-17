import { copyFile, readFile, rename, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { Effect, Exit, Schedule, Schema } from "effect";

export class NiagaraSessionError extends Schema.TaggedError<NiagaraSessionError>()(
	"NiagaraSessionError",
	{ message: Schema.String, cause: Schema.optionalKey(Schema.Defect()) }
) {}
const failure = (message: string, cause?: unknown) =>
	new NiagaraSessionError({ message, ...(cause === undefined ? undefined : { cause }) });
const maximumSessionFileBytes = 4096;
class OversizedSessionFile extends Error {}
const resultSchema = Schema.Struct({
	protocol: Schema.Literal("ue-shed-niagara-session.v1"),
	runId: Schema.String,
	exitCode: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }))
});
const readOptional = (path: string) =>
	Effect.tryPromise({
		try: async () => {
			try {
				const details = await stat(path);
				if (details.size > maximumSessionFileBytes) throw new OversizedSessionFile();
				return await readFile(path, "utf8");
			} catch (error) {
				if (error instanceof Error && "code" in error && error.code === "ENOENT")
					return undefined;
				throw error;
			}
		},
		catch: (cause) =>
			failure(
				cause instanceof OversizedSessionFile
					? `Niagara session file ${path} exceeds ${maximumSessionFileBytes} bytes.`
					: `Could not read Niagara session file ${path}.`,
				cause
			)
	});

/** The host owns the process; interruption leaves a cancellation marker before releasing the request. */
export const submitNiagaraSessionRequest = Effect.fn("NiagaraSession.submit")(function* (input: {
	directory: string;
	requestPath: string;
	runId: string;
	timeoutMs?: number;
}) {
	if (!isAbsolute(input.directory) || !/^[a-f0-9-]{36}$/.test(input.runId))
		return yield* Effect.fail(failure("Invalid Niagara session request."));
	const ready = yield* readOptional(join(input.directory, "ready.json"));
	yield* Schema.decodeUnknownEffect(
		Schema.fromJsonString(
			Schema.Struct({
				protocol: Schema.Literal("ue-shed-niagara-session.v1")
			})
		)
	)(ready).pipe(Effect.mapError(() => failure("Session is not ready.")));
	const prefix = join(input.directory, input.runId);
	const poll = Effect.gen(function* () {
		const text = yield* readOptional(`${prefix}.result.json`);
		if (text !== undefined) {
			const result = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(resultSchema))(
				text
			).pipe(Effect.mapError(() => failure("Invalid session result.")));
			if (result.runId !== input.runId)
				return yield* Effect.fail(failure("Invalid session result identity."));
			return result.exitCode;
		}
		if ((yield* readOptional(join(input.directory, "closed"))) !== undefined)
			return yield* Effect.fail(failure("Niagara session closed before completing capture."));
		return undefined;
	}).pipe(
		Effect.repeat({
			schedule: Schedule.spaced("100 millis"),
			while: (result) => result === undefined
		})
	);
	const result = yield* Effect.acquireUseRelease(
		Effect.tryPromise({
			try: async () => {
				await copyFile(input.requestPath, `${prefix}.pending`);
				await rename(`${prefix}.pending`, `${prefix}.request.json`);
			},
			catch: (cause) =>
				failure(
					`Could not submit Niagara session request ${input.runId} to ${input.directory}.`,
					cause
				)
		}),
		() => poll.pipe(Effect.timeout(input.timeoutMs ?? 30 * 60_000)),
		(_, exit) =>
			Exit.isSuccess(exit)
				? Effect.void
				: Effect.tryPromise({
						try: () => writeFile(`${prefix}.cancel`, "cancelled\n"),
						catch: (cause) =>
							failure(
								`Could not write the cancellation marker for Niagara session run ${input.runId}.`,
								cause
							)
					}).pipe(
						Effect.tapError((error) =>
							Effect.logWarning("Niagara session cancellation marker failed", error)
						),
						Effect.ignore
					)
	);
	if (result === undefined) return yield* Effect.die("Session polling ended without a result.");
	return result;
});
