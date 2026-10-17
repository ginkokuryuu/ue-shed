import { GameTextOperationProgress } from "@ue-shed/game-text/schema";
import { makeGameTextOperations, type GameTextOperationsApi } from "@ue-shed/game-text/workspace";
import { Context, Effect, Layer, Schema } from "effect";
import { WorkbenchWindow } from "../adapters/electron-window.js";
import { WorkbenchConfiguration } from "../workbench-config.js";
import { WorkbenchProject } from "./project-workspace.js";
import { WorkbenchGameText } from "./game-text.js";

export { safeLocalizationLogLine } from "@ue-shed/game-text/workspace";

export type WorkbenchGameTextOperationsApi = GameTextOperationsApi;
export class WorkbenchGameTextOperations extends Context.Service<
	WorkbenchGameTextOperations,
	WorkbenchGameTextOperationsApi
>()("@ue-shed/workbench/WorkbenchGameTextOperations") {}

/** The workspace's Unreal localization steps, with Workbench's engine setting and window events. */
export const WorkbenchGameTextOperationsLive = Layer.effect(
	WorkbenchGameTextOperations,
	Effect.gen(function* () {
		const gameText = yield* WorkbenchGameText;
		const project = yield* WorkbenchProject;
		const configuration = yield* WorkbenchConfiguration;
		const window = yield* WorkbenchWindow;
		return WorkbenchGameTextOperations.of(
			yield* makeGameTextOperations({
				workspace: gameText,
				project,
				engineRoot: () =>
					configuration.unrealEngineRoot?.status === "configured"
						? configuration.unrealEngineRoot.path
						: undefined,
				notifyProgress: Effect.fn("Workbench.GameTextOperations.notifyProgress")(function* (
					progress: GameTextOperationProgress
				) {
					yield* window.send(
						"game-text:localization:operation-progress",
						Schema.encodeSync(GameTextOperationProgress)(progress)
					);
				})
			})
		);
	})
);
