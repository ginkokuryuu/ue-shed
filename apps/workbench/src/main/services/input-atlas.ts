import type { EnhancedInputRunResult } from "@ue-shed/enhanced-input";
import { Context, Effect, Layer } from "effect";
import { WorkbenchProject } from "./project-workspace.js";

export interface WorkbenchInputAtlasApi {
	readonly configuredScan: () => Effect.Effect<EnhancedInputRunResult>;
}

export class WorkbenchInputAtlas extends Context.Service<
	WorkbenchInputAtlas,
	WorkbenchInputAtlasApi
>()("@ue-shed/workbench/WorkbenchInputAtlas") {}

export const WorkbenchInputAtlasLive = Layer.effect(
	WorkbenchInputAtlas,
	Effect.gen(function* () {
		const project = yield* WorkbenchProject;

		const configuredScan = Effect.fn("Workbench.WorkbenchInputAtlas.configuredScan")(
			function* () {
				// Without a selected project the route sends users to the shell's project picker.
				const current = yield* project.current();
				if (current.status === "not_configured" || current.status === "cancelled")
					return { status: "not_configured" as const };
				return yield* project.inputAtlas();
			}
		);

		return WorkbenchInputAtlas.of({ configuredScan });
	})
);

export function makeWorkbenchInputAtlasTestLayer(
	service: WorkbenchInputAtlasApi
): Layer.Layer<WorkbenchInputAtlas> {
	return Layer.succeed(WorkbenchInputAtlas, WorkbenchInputAtlas.of(service));
}
