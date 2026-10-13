import type {
	CustodianCancelRunResult,
	CustodianExecutionRunResult,
	CustodianPrepareIntent,
	CustodianPrepareRunResult,
	CustodianRunResult
} from "@ue-shed/extension-project-custodian/client";
import {
	Custodian,
	type CustodianExecuteRequest,
	type CustodianProposalId
} from "@ue-shed/project-custodian";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { ElectronApp } from "../adapters/electron-app.js";
import { WorkbenchConfiguration } from "../workbench-config.js";
import { WorkbenchProject } from "./project-workspace.js";

export interface WorkbenchCustodianApi {
	readonly configuredScan: () => Effect.Effect<CustodianRunResult>;
	readonly prepare: (intent: CustodianPrepareIntent) => Effect.Effect<CustodianPrepareRunResult>;
	readonly execute: (
		intent: CustodianExecuteRequest
	) => Effect.Effect<CustodianExecutionRunResult>;
	readonly cancel: (proposalId: CustodianProposalId) => Effect.Effect<CustodianCancelRunResult>;
}

export class WorkbenchCustodian extends Context.Service<
	WorkbenchCustodian,
	WorkbenchCustodianApi
>()("@ue-shed/workbench/WorkbenchCustodian") {}

export const WorkbenchCustodianLive = Layer.effect(
	WorkbenchCustodian,
	Effect.gen(function* () {
		const configuration = yield* WorkbenchConfiguration;
		const custodian = yield* Custodian;
		const project = yield* WorkbenchProject;
		const electronApp = yield* ElectronApp;

		const scan = Effect.fn("Workbench.ProjectCustodian.scan")(function* (scanRoot: string) {
			return yield* custodian.scan({ root: scanRoot }).pipe(
				Effect.map((report) => ({ status: "completed" as const, report })),
				Effect.catch((error) =>
					Effect.succeed({
						status: "failed" as const,
						error: {
							code: "scan_failed" as const,
							message: error.message,
							recovery: error.recovery,
							retrySafe: error.retrySafe
						}
					})
				)
			);
		});

		// An explicit custodian root may span several projects; otherwise the shell's project is scanned.
		const configuredScan = Effect.fn("Workbench.ProjectCustodian.configuredScan")(function* () {
			if (configuration.custodianRoot?.status === "configured")
				return yield* scan(configuration.custodianRoot.path);
			const current = yield* project.current();
			return current.status === "ready"
				? yield* scan(current.project.projectRoot)
				: ({ status: "not_configured" } as const);
		});

		const prepare = Effect.fn("Workbench.ProjectCustodian.prepare")(function* (
			intent: CustodianPrepareIntent
		) {
			return yield* Effect.gen(function* () {
				const userData = yield* electronApp.getPath("userData");
				const proposal = yield* custodian.prepare({
					...intent,
					proposalDirectory: join(userData, "custodian")
				});
				return { status: "completed" as const, proposal };
			}).pipe(
				Effect.catch((error) =>
					Effect.succeed({
						status: "failed" as const,
						error: {
							code: "prepare_failed" as const,
							message: error.message,
							recovery: error.recovery,
							retrySafe: error.retrySafe
						}
					})
				)
			);
		});

		const execute = Effect.fn("Workbench.ProjectCustodian.execute")(function* (
			intent: CustodianExecuteRequest
		) {
			return yield* custodian.execute(intent).pipe(
				Effect.map((receipt) => ({ status: "completed" as const, receipt })),
				Effect.catch((error) =>
					Effect.succeed({
						status: "failed" as const,
						error: {
							code: "execution_failed" as const,
							message: error.message,
							recovery: error.recovery,
							retrySafe: error.retrySafe
						}
					})
				)
			);
		});

		const cancel = Effect.fn("Workbench.ProjectCustodian.cancel")(function* (
			proposalId: CustodianProposalId
		) {
			return yield* custodian.cancel(proposalId).pipe(
				Effect.map((result) => ({ status: "completed" as const, result })),
				Effect.catch((error) =>
					Effect.succeed({
						status: "failed" as const,
						error: {
							code: "execution_failed" as const,
							message: error.message,
							recovery: error.recovery,
							retrySafe: error.retrySafe
						}
					})
				)
			);
		});

		return WorkbenchCustodian.of({ configuredScan, prepare, execute, cancel });
	})
);

export function makeWorkbenchCustodianTestLayer(
	service: WorkbenchCustodianApi
): Layer.Layer<WorkbenchCustodian> {
	return Layer.succeed(WorkbenchCustodian, WorkbenchCustodian.of(service));
}
