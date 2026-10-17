import { Context, Effect, Layer, Semaphore } from "effect";
import { GameTextIndexBuildRequest, type GameTextIndexBuildOutcome } from "@ue-shed/protocol";
import { Schema } from "effect";
import { AssetReaderError, type AssetReaderConfiguration } from "./asset-reader.js";
import {
	invokeProtocolSessionSingle,
	makeProtocolRequest,
	UassetProtocolSession
} from "./protocol-transport.js";

/** Uses the existing scoped process transport, including framing, cancellation and telemetry. */
export class NativeGameTextIndexClient extends Context.Service<
	NativeGameTextIndexClient,
	{
		readonly execute: (
			request: GameTextIndexBuildRequest
		) => Effect.Effect<GameTextIndexBuildOutcome, AssetReaderError>;
	}
>()("@ue-shed/unreal-assets/NativeGameTextIndexClient") {}

export const nativeGameTextIndexClientLayer = (configuration: AssetReaderConfiguration) =>
	Layer.effect(
		NativeGameTextIndexClient,
		Effect.gen(function* () {
			const mutex = yield* Semaphore.make(1);
			const session = yield* Effect.acquireRelease(
				Effect.sync(
					() =>
						new UassetProtocolSession({
							...configuration,
							timeoutMs: configuration.catalogTimeoutMs
						})
				),
				(session) => Effect.promise(() => session.close())
			);
			return NativeGameTextIndexClient.of({
				execute: Effect.fn("NativeGameTextIndex.execute")(function* (input) {
					const decoded = yield* Schema.decodeUnknownEffect(GameTextIndexBuildRequest)(
						input
					).pipe(
						Effect.mapError(
							(cause) =>
								new AssetReaderError({
									kind: "contract",
									operation: "game_text_index",
									nextStep: "fix_input",
									recovery:
										"Validate the native Game Text index request before submitting it.",
									message: String(cause),
									retrySafe: false
								})
						)
					);
					const request = decoded;
					const outcome = yield* mutex.withPermits(1)(
						invokeProtocolSessionSingle({
							session,
							configuration,
							operation: "game_text_index",
							path:
								request.action === "capabilities"
									? "capabilities"
									: request.configuration.projectKey,
							request: makeProtocolRequest(
								{ kind: "game_text_index", request },
								{
									maximumOutputBytes: 64 * 1024 ** 2,
									timeoutMs: configuration.catalogTimeoutMs
								},
								{ contractMinor: 13 }
							),
							expected: "game_text_index",
							select: (result) =>
								result.kind === "game_text_index" ? result.outcome : undefined
						})
					);
					yield* Effect.annotateCurrentSpan({
						"game_text.build.action": request.action,
						...Object.fromEntries(
							Object.entries(outcome.stageSeconds).map(([stage, seconds]) => [
								`game_text.build.seconds.${stage}`,
								seconds
							])
						)
					});
					return outcome;
				})
			});
		})
	);
