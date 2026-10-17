import { Config, Context, Duration, Effect, Layer, Schema } from "effect";
import { ErrorGuidanceFields, type ErrorNextStep } from "@ue-shed/protocol";
import { TransportRequestError, UnrealRC } from "unreal-rc";

const RemoteCallEnvelope = Schema.Struct({ ResultJson: Schema.String });
const decodeRemoteCallEnvelope = Schema.decodeUnknownEffect(RemoteCallEnvelope);

export class RemoteControlClientError extends Schema.TaggedError<RemoteControlClientError>()(
	"RemoteControlClientError",
	{
		endpoint: Schema.String,
		functionName: Schema.String,
		operation: Schema.String,
		status: Schema.optional(Schema.Number),
		...ErrorGuidanceFields
	}
) {}

export interface RemoteControlRequest {
	readonly endpoint: string;
	readonly functionName: string;
	readonly objectPath: string;
	readonly operation?: string;
	readonly parameters: Schema.JsonObject;
	readonly timeout?: Duration.Input;
}

export interface RemoteControlClientApi {
	readonly request: (
		request: RemoteControlRequest
	) => Effect.Effect<Schema.Json, RemoteControlClientError>;
}

/** @deprecated Use `RemoteControlClientApi`. */
export type RemoteControlClientShape = RemoteControlClientApi;

export class RemoteControlClient extends Context.Service<
	RemoteControlClient,
	RemoteControlClientApi
>()("@ue-shed/unreal-connection/RemoteControlClient") {}

const malformedResponseRecovery =
	"The editor returned a malformed response. Install the UE Shed editor plugin version paired with this host, or report the response.";

function normalizedEndpoint(endpoint: string): string {
	return endpoint.replace(/\/+$/, "");
}

function clientError(
	request: RemoteControlRequest,
	fields: {
		readonly message: string;
		readonly recovery: string;
		readonly retrySafe: boolean;
		readonly nextStep: ErrorNextStep;
		readonly status?: number;
	}
): RemoteControlClientError {
	return new RemoteControlClientError({
		endpoint: normalizedEndpoint(request.endpoint),
		functionName: request.functionName,
		message: fields.message,
		operation: request.operation ?? `remote_control.${request.functionName}`,
		recovery: fields.recovery,
		retrySafe: fields.retrySafe,
		nextStep: fields.nextStep,
		...(fields.status === undefined ? undefined : { status: fields.status })
	});
}

function transportError(request: RemoteControlRequest, cause: unknown): RemoteControlClientError {
	if (!(cause instanceof TransportRequestError)) {
		return clientError(request, {
			message: `Remote Control transport failed: ${String(cause)}`,
			recovery:
				"Confirm the editor is running with the Remote Control API enabled; report the error if it persists.",
			retrySafe: false,
			nextStep: "escalate"
		});
	}

	const status = cause.statusCode;
	const retrySafe =
		cause.kind === "connect" ||
		cause.kind === "disconnect" ||
		cause.kind === "timeout" ||
		(status !== undefined && status >= 500);
	return clientError(request, {
		message:
			status === undefined
				? cause.message
				: `Remote Control returned HTTP ${status}: ${cause.message}`,
		recovery: retrySafe
			? "Start the editor with the Remote Control API enabled at this endpoint, wait until it is responsive, then retry."
			: "The editor rejected the call. Check the endpoint, object path and that the UE Shed editor plugin matches this host.",
		retrySafe,
		nextStep: retrySafe ? "retry" : "fix_input",
		...(status === undefined ? undefined : { status })
	});
}

export function makeRemoteControlClient(options: {
	readonly defaultTimeout: Duration.Input;
}): RemoteControlClientApi {
	const request = Effect.fn("RemoteControlClient.request")(
		function* (request: RemoteControlRequest) {
			const endpoint = normalizedEndpoint(request.endpoint);
			const timeout = request.timeout ?? options.defaultTimeout;
			const response = yield* Effect.scoped(
				Effect.acquireRelease(
					Effect.try({
						try: () =>
							new UnrealRC({
								transport: "http",
								// This adapter validates ResultJson; the upstream schema strips named return fields.
								validateResponses: false,
								http: {
									baseUrl: endpoint,
									requestTimeoutMs: Duration.toMillis(timeout)
								},
								retry: false
							}),
						catch: (cause) => transportError(request, cause)
					}),
					(client) => Effect.promise(() => client.dispose().catch(() => undefined))
				).pipe(
					Effect.flatMap((client) =>
						Effect.tryPromise({
							try: () =>
								client.call({
									functionName: request.functionName,
									objectPath: request.objectPath,
									parameters: request.parameters,
									retry: false,
									timeoutMs: Duration.toMillis(timeout),
									transaction: false
								}),
							catch: (cause) => transportError(request, cause)
						})
					)
				)
			);
			const envelope = yield* decodeRemoteCallEnvelope(response).pipe(
				Effect.mapError((cause) =>
					clientError(request, {
						message: `Invalid Remote Control envelope: ${String(cause)}`,
						recovery: malformedResponseRecovery,
						retrySafe: false,
						nextStep: "escalate"
					})
				)
			);
			return yield* Effect.try({
				try: () => Schema.decodeUnknownSync(Schema.Json)(JSON.parse(envelope.ResultJson)),
				catch: (cause) =>
					clientError(request, {
						message: `Invalid Remote Control JSON: ${String(cause)}`,
						recovery: malformedResponseRecovery,
						retrySafe: false,
						nextStep: "escalate"
					})
			});
		},
		(effect, request) =>
			effect.pipe(
				Effect.withSpan(request.operation ?? `remote_control.${request.functionName}`, {
					attributes: {
						"unreal.endpoint": normalizedEndpoint(request.endpoint),
						"unreal.function": request.functionName
					}
				})
			)
	);

	return RemoteControlClient.of({ request });
}

const defaultTimeout = Config.Duration("UE_SHED_REMOTE_CONTROL_TIMEOUT").pipe(
	Config.withDefault(Duration.seconds(10))
);

export const RemoteControlClientLive = Layer.effect(
	RemoteControlClient,
	Effect.gen(function* () {
		return makeRemoteControlClient({ defaultTimeout: yield* defaultTimeout });
	})
);

export function makeRemoteControlClientTestLayer(
	handle: RemoteControlClientApi["request"]
): Layer.Layer<RemoteControlClient> {
	return Layer.succeed(RemoteControlClient, RemoteControlClient.of({ request: handle }));
}
