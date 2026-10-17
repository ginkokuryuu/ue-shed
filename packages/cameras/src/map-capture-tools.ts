import { Effect, Schema } from "effect";
import { decodeCompanionCapabilityManifest, ErrorGuidanceFields } from "@ue-shed/protocol";
import { RemoteControlClient, RemoteControlClientError } from "@ue-shed/unreal-connection";
import { MapCaptureSelection, MapCaptureReadiness } from "./map-capture-tools-schema.js";
export * from "./map-capture-tools-schema.js";
export class MapCaptureInspectionError extends Schema.TaggedError<MapCaptureInspectionError>()(
	"MapCaptureInspectionError",
	ErrorGuidanceFields
) {}
const failure = (cause: unknown) =>
	cause instanceof MapCaptureInspectionError
		? cause
		: cause instanceof RemoteControlClientError
			? new MapCaptureInspectionError({
					message: cause.message,
					nextStep: cause.nextStep,
					recovery: cause.recovery,
					retrySafe: cause.retrySafe
				})
			: new MapCaptureInspectionError({
					message: String(cause),
					nextStep: "escalate",
					recovery:
						"Check the editor endpoint and update Core and Cameras plugins together.",
					retrySafe: true
				});
const negotiate = Effect.fn("MapCapture.inspect.negotiate")(function* (
	endpoint: string,
	capability: string
) {
	const client = yield* RemoteControlClient;
	const manifest = yield* client
		.request({
			endpoint,
			functionName: "GetCapabilityManifest",
			objectPath: "/Script/UEShedCore.Default__UEShedCoreLibrary",
			operation: "map_capture.inspect.negotiate",
			parameters: {}
		})
		.pipe(Effect.flatMap(decodeCompanionCapabilityManifest));
	if (!manifest.capabilities.includes(capability))
		return yield* Effect.fail(
			new MapCaptureInspectionError({
				message: `Editor does not advertise ${capability}.`,
				nextStep: "fix_input",
				recovery: "Update Core and Cameras plugins and restart the editor.",
				retrySafe: true
			})
		);
	return client;
});
export const inspectMapCaptureSelection = Effect.fn("MapCapture.inspect.selection")(function* (
	endpoint: string
) {
	const client = yield* negotiate(endpoint, "cameras.capture-selection.v1");
	return yield* client
		.request({
			endpoint,
			functionName: "InspectMapCaptureSelection",
			objectPath: "/Script/UEShedCamerasEditor.Default__UEShedCameraReviewLibrary",
			operation: "map_capture.inspect.selection",
			parameters: {}
		})
		.pipe(Effect.flatMap(Schema.decodeUnknownEffect(MapCaptureSelection)));
}, Effect.mapError(failure));
export const inspectMapCaptureReadiness = Effect.fn("MapCapture.inspect.readiness")(function* (
	endpoint: string,
	expectedMapPath: string
) {
	const client = yield* negotiate(endpoint, "cameras.capture-readiness.v1");
	if (!/^\/Game\/[A-Za-z0-9_/]+$/.test(expectedMapPath))
		return yield* Effect.fail(
			new MapCaptureInspectionError({
				message: "Expected a /Game/ map package path.",
				nextStep: "fix_input",
				recovery: "Use the map package path from the capture plan.",
				retrySafe: true
			})
		);
	return yield* client
		.request({
			endpoint,
			functionName: "InspectMapCaptureReadiness",
			objectPath: "/Script/UEShedCamerasEditor.Default__UEShedCameraReviewLibrary",
			operation: "map_capture.inspect.readiness",
			parameters: { ExpectedMapPath: expectedMapPath }
		})
		.pipe(Effect.flatMap(Schema.decodeUnknownEffect(MapCaptureReadiness)));
}, Effect.mapError(failure));
