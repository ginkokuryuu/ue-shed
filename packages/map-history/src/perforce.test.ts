import { Context, Effect, Fiber, Layer } from "effect";
import {
	P4CommandError,
	type P4ChangelistDescription,
	type ListChangelistsOptions,
	type ListDepotFilesAtChangeOptions,
	P4DepotPath,
	P4FileAction,
	P4LocalPath
} from "p4client-ts";
import { createP4Client } from "p4client-ts/promise";
import { describe, expect, it } from "vitest";
import {
	makePerforceHistorySource,
	PerforceHistorySource,
	PerforceProjectContext,
	perforceHistorySourceLayer,
	selectPerforceWorkspace
} from "./perforce.js";

function backend() {
	const description: P4ChangelistDescription = {
		change: 42,
		client: "workspace",
		createdAt: "2026-07-28T12:00:00.000Z",
		description: "Move actor",
		files: [
			{
				action: P4FileAction.make("edit"),
				depotFile: P4DepotPath.make("//Project/Main/Content/Maps/L_Example.umap"),
				revision: 7,
				digest: null,
				fileSize: null,
				type: "binary"
			}
		],
		status: "submitted",
		messages: [],
		user: "artist"
	};
	return {
		describeChangelist: () => Effect.succeed(description),
		listDepotFilesAtChange: () => Effect.succeed({ hasMore: false, items: [], messages: [] }),
		listSubmittedChangelists: () =>
			Effect.succeed({
				hasMore: false,
				items: [
					{
						change: 42,
						client: "workspace",
						createdAt: "2026-07-28T12:00:00.000Z",
						description: "Move actor",
						status: "submitted" as const,
						isDefault: false,
						user: "artist"
					}
				],
				nextCursor: null,
				messages: []
			}),
		materializeDepotFiles: () =>
			Effect.succeed({
				directory: P4LocalPath.make("C:/temp/history"),
				items: [],
				messages: []
			}),
		resolveLocalPath: () =>
			Effect.succeed({ depotPath: "//Project/Main/Content/Maps/L_Example.umap" })
	};
}

describe("PerforceHistorySource", () => {
	it("selects the workspace bound to the selected project root", () => {
		expect(
			selectPerforceWorkspace({
				configuredClient: "configured-client",
				projectRoot: "D:/Perforce/ExampleProject",
				workspaces: [
					{ client: "example-client", root: "d:\\Perforce\\ExampleProject" },
					{ client: "other-client", root: "E:\\Perforce\\OtherProject" }
				]
			})
		).toBe("example-client");
	});

	it("resolves a backend against the selected project context", async () => {
		const roots: (string | undefined)[] = [];
		const source = makePerforceHistorySource((projectRoot) => {
			roots.push(projectRoot);
			return backend();
		});

		await Effect.runPromise(
			source
				.listSubmittedChangelists({ limit: 1 })
				.pipe(Effect.provideService(PerforceProjectContext, "D:/Perforce/ExampleProject"))
		);

		expect(roots).toEqual(["D:/Perforce/ExampleProject"]);
	});

	it("runs project-scoped commands with the matching client", async () => {
		const calls: {
			client: string | undefined;
			config: string | undefined;
			cwd: string | undefined;
		}[] = [];
		const disposed: string[] = [];
		const createClient: NonNullable<Parameters<typeof perforceHistorySourceLayer>[1]> = (
			options
		) => {
			const client = createP4Client(options);
			return {
				...client,
				resolveConnection: async () => ({
					connection: {
						port: "localhost:1666",
						user: "developer",
						client: "configured-client"
					},
					sources: {}
				}),
				getEnvironment: async () => ({
					user: "developer",
					client: "configured-client",
					clientHost: "DEV-WORKSTATION",
					port: null,
					serverAddress: null,
					serverVersion: null,
					unicode: false,
					caseInsensitive: false,
					messages: []
				}),
				listWorkspaces: async () => ({
					items: [
						{
							client: "example-client",
							root: "D:/Perforce/ExampleProject",
							owner: "developer",
							host: null,
							stream: null,
							description: null,
							accessedAt: null,
							updatedAt: null
						}
					],
					messages: []
				}),
				whereFiles: async () => {
					calls.push({
						client: options.connection?.client,
						config: options.env?.P4CONFIG,
						cwd: options.cwd
					});
					return {
						items: [
							{
								depotFile: P4DepotPath.make(
									"//Depot/Main/Content/Maps/Example.umap"
								),
								clientFile: null,
								localFile: null,
								isExcluded: false
							}
						],
						messages: [],
						failures: []
					};
				},
				dispose: async () => {
					disposed.push("disposed");
					await client.dispose();
				}
			};
		};
		const context = await Effect.runPromise(
			Effect.scoped(Layer.build(perforceHistorySourceLayer({}, createClient)))
		);
		const source = Context.get(context, PerforceHistorySource);
		const mapping = await Effect.runPromise(
			source
				.resolveLocalPath("D:/Perforce/ExampleProject/Content/Maps/Example.umap")
				.pipe(Effect.provideService(PerforceProjectContext, "D:/Perforce/ExampleProject"))
		);
		expect(mapping.depotPath).toBe("//Depot/Main/Content/Maps/Example.umap");
		expect(calls[0]?.cwd).toBe("D:/Perforce/ExampleProject");
		expect(calls[0]?.client).toBe("example-client");
		expect(calls[0]?.config).toMatch(/ue-shed-no-p4config$/u);
		expect(disposed).toHaveLength(2);
	});

	it("translates p4client values at the acquisition boundary", async () => {
		const source = makePerforceHistorySource(backend());

		const result = await Effect.runPromise(
			source.listSubmittedChangelists({
				fileSpec: "//Project/Main/Content/Maps/...",
				limit: 100
			})
		);

		expect(result).toEqual({
			hasMore: false,
			items: [
				{
					change: 42,
					description: "Move actor",
					submittedAt: "2026-07-28T12:00:00.000Z",
					user: "artist"
				}
			],
			nextBeforeChange: null
		});
	});

	it("maps authentication failures to the map-history error vocabulary", async () => {
		const source = makePerforceHistorySource({
			...backend(),
			listSubmittedChangelists: () =>
				Effect.fail(
					new P4CommandError({
						message: "Perforce password invalid or unset.",
						args: ["changes"],
						command: "p4",
						exitCode: 1,
						stderr: "",
						messages: [],
						reason: "not_logged_in",
						category: "authentication"
					})
				)
		});

		const error = await Effect.runPromise(
			Effect.flip(source.listSubmittedChangelists({ limit: 1 }))
		);

		expect(error.kind).toBe("perforce_authentication");
		expect(error.retrySafe).toBe(false);
	});

	it.each([
		["permission", "perforce_authentication"],
		["not_in_view", "ambiguous_depot_mapping"],
		["configuration", "perforce_configuration"],
		["not_found", "perforce_command"]
	] as const)("maps %s command failures to %s", async (category, kind) => {
		const source = makePerforceHistorySource({
			...backend(),
			describeChangelist: () =>
				Effect.fail(
					new P4CommandError({
						message: "Perforce rejected the command.",
						args: ["describe"],
						command: "p4",
						exitCode: 1,
						stderr: "",
						messages: [],
						reason: "unknown",
						category
					})
				)
		});

		const error = await Effect.runPromise(Effect.flip(source.describeChangelist(42)));

		expect(error.kind).toBe(kind);
		expect(error.retrySafe).toBe(false);
	});
	it("preserves the inclusive pagination cursor and exact snapshot bounds", async () => {
		let changes: ListChangelistsOptions | undefined;
		let snapshot: ListDepotFilesAtChangeOptions | undefined;
		const source = makePerforceHistorySource({
			...backend(),
			listSubmittedChangelists: (options) => {
				changes = options;
				return Effect.succeed({ items: [], messages: [], hasMore: true, nextCursor: 39 });
			},
			listDepotFilesAtChange: (options) => {
				snapshot = options;
				return Effect.succeed({ items: [], messages: [], hasMore: true });
			}
		});
		const page = await Effect.runPromise(
			source.listSubmittedChangelists({ beforeChange: 42, fileSpec: "//Depot/...", limit: 3 })
		);
		expect(changes).toEqual({
			status: "submitted",
			cursor: 42,
			fileSpec: "//Depot/...",
			limit: 3
		});
		expect(page.nextBeforeChange).toBe(39);
		expect(page.hasMore).toBe(true);
		expect(
			await Effect.runPromise(
				source.listDepotFilesAtChange({ depotPath: "//Depot/...", change: 42, maxFiles: 7 })
			)
		).toEqual({ files: [], hasMore: true });
		expect(snapshot).toEqual({ file: "//Depot/...", change: 42, limit: 7 });
	});

	it("retains revision metadata when materialization returns only exact specs", async () => {
		const file = {
			action: "edit",
			changelist: 42,
			depotPath: "//Depot/map.umap",
			revision: 7,
			type: "binary"
		};
		const source = makePerforceHistorySource({
			...backend(),
			materializeDepotFiles: (options) =>
				Effect.succeed({
					directory: P4LocalPath.make("C:/temp/history"),
					messages: [],
					items: options.fileSpec.map((spec) => ({
						file: { depotFile: spec.depotFile, revision: spec.revision },
						localPath: P4LocalPath.make("C:/temp/history/Depot/map.umap")
					}))
				})
		});
		const result = await Effect.runPromise(
			source.materializeDepotFiles({
				directory: "C:/temp/history",
				files: [file],
				maxFiles: 1
			})
		);
		expect(result.files[0]?.file).toEqual(file);
		expect(result.totalCount).toBe(1);
	});

	it.each(["excluded", "overlapping", "unmapped"] as const)(
		"rejects %s workspace mappings",
		async (kind) => {
			const createClient: NonNullable<Parameters<typeof perforceHistorySourceLayer>[1]> = (
				options
			) => {
				const client = createP4Client(options);
				const row = {
					depotFile: P4DepotPath.make("//Depot/map.umap"),
					clientFile: null,
					localFile: null,
					isExcluded: kind === "excluded"
				};
				return {
					...client,
					whereFiles: async () => ({
						items:
							kind === "unmapped" ? [] : kind === "overlapping" ? [row, row] : [row],
						messages: [],
						failures: []
					})
				};
			};
			const error = await Effect.runPromise(
				Effect.gen(function* () {
					const source = yield* PerforceHistorySource;
					return yield* Effect.flip(source.resolveLocalPath("C:/workspace/map.umap"));
				}).pipe(Effect.provide(perforceHistorySourceLayer({}, createClient)))
			);
			expect(error.kind).toBe("ambiguous_depot_mapping");
		}
	);

	it("aborts the Promise command and disposes its runtime on interruption", async () => {
		let start = () => {};
		const started = new Promise<void>((resolve) => {
			start = resolve;
		});
		let aborted = false;
		let disposed = false;
		const createClient: NonNullable<Parameters<typeof perforceHistorySourceLayer>[1]> = (
			options
		) => {
			const client = createP4Client(options);
			return {
				...client,
				whereFiles: (request) =>
					new Promise((_resolve, reject) => {
						request.signal?.addEventListener(
							"abort",
							() => {
								aborted = true;
								reject(request.signal?.reason);
							},
							{ once: true }
						);
						start();
					}),
				dispose: async () => {
					disposed = true;
					await client.dispose();
				}
			};
		};
		const fiber = Effect.runFork(
			Effect.gen(function* () {
				const source = yield* PerforceHistorySource;
				return yield* source.resolveLocalPath("C:/workspace/map.umap");
			}).pipe(Effect.provide(perforceHistorySourceLayer({}, createClient)))
		);
		await started;
		await Effect.runPromise(Fiber.interrupt(fiber));
		expect(aborted).toBe(true);
		expect(disposed).toBe(true);
	});
});
