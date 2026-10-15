import { randomUUID, createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import {
	Cache,
	Context,
	Effect,
	Exit,
	Layer,
	Ref,
	Schema,
	Semaphore,
	RcMap,
	Stream,
	Struct,
	Scope
} from "effect";
import {
	readLocalizationReview,
	emptyLocalizationReviewFile,
	defaultLocalizationReviewPath,
	LocalizationFileAccessLive,
	LocalizationEvidence,
	LocalizationTarget
} from "@ue-shed/localization";
import {
	SharedIndex,
	sharedIndexNodeLayer,
	type SharedIndexOptions,
	type SharedIndexManifest,
	sharedIndexDirectory
} from "./shared-index.js";
import { GameTextIndexBuilder, type GameTextIndexBuildSessionRequest } from "./index-builder.js";
import { GameTextIndexProgressReporter } from "./index-progress.js";
import {
	GameTextIndexError,
	GameTextIndexSource,
	GameTextIndexRefreshRequest,
	type GameTextIndexRefreshResult,
	type IndexFailure
} from "./index-contract.js";
import { SnapshotStoreError } from "./snapshot-store.js";
import { SnapshotFormatError } from "./snapshot-format.js";
import { reuseJoinedQueryProjection, type JoinedQueryProjection } from "./joined-query-data.js";
import { instrumentIndexQuery } from "./index-query.js";
import { columnarTextCorpusQuery } from "./columnar-query.js";
import { makeGameTextSearchWorkerResource } from "./search-worker-node.js";
import { SearchWorkerInput } from "./search-worker-protocol.js";
import {
	indexedTextCorpus,
	indexedLocalizationJoin,
	indexedLocalizationLinesRequest,
	readIndexedLocalizationEvidence
} from "./index-context.js";
import { indexedLocalizationQuality } from "./localization-quality-index.js";
import { indexedSourceQuality } from "./source-quality-index.js";
import { openJoinedTarget, readJoinedTarget } from "./joined-target-reader.js";
import type { TextCorpusSearchRequest } from "./schema.js";
import type { importLocalizationTarget } from "./localization-import.js";
import type { refreshPackageTextLayer } from "./package-text-layer.js";
import type { refreshJoinedTarget, JoinedTargetInput } from "./joined-target.js";
import type { LocalizationReviewSnapshot } from "@ue-shed/localization";
import type { GameTextProjectView } from "./project-index-view.js";
import { encodeWtf8 } from "./wtf8.js";
import { mountPackageTextEvent } from "./package-object-path.js";
import {
	observeGameTextImport,
	checkRetainedImportObservations
} from "./index-import-observation.js";

export const GameTextProjectRefreshRequest = Schema.Struct(
	Struct.pick(GameTextIndexRefreshRequest.fields, [
		"projectRoot",
		"changedFiles",
		"savedPackages"
	])
);
export type GameTextProjectRefreshRequest = typeof GameTextProjectRefreshRequest.Type;
export const GameTextTargetImportRequest = Schema.Struct(
	Struct.pick(GameTextIndexRefreshRequest.fields, [
		"targetName",
		"requireManifest",
		"changedFiles"
	])
);
export type GameTextTargetImportRequest = typeof GameTextTargetImportRequest.Type;
export const GameTextTargetBuildRequest = Schema.Struct(
	Struct.pick(GameTextIndexRefreshRequest.fields, ["keyChangePairs", "tolerateReviewErrors"])
);
export type GameTextTargetBuildRequest = typeof GameTextTargetBuildRequest.Type;

type Packages = Effect.Success<ReturnType<typeof refreshPackageTextLayer>>;
type Imported = Effect.Success<ReturnType<typeof importLocalizationTarget>>;
type Join = Effect.Success<ReturnType<typeof refreshJoinedTarget>>;
type MutableFileErrors = {
	-readonly [K in keyof NonNullable<JoinedTargetInput["fileErrors"]>]: NonNullable<
		JoinedTargetInput["fileErrors"]
	>[K];
};
type MutableFileProvenances = {
	-readonly [K in keyof NonNullable<JoinedTargetInput["fileProvenances"]>]: NonNullable<
		JoinedTargetInput["fileProvenances"]
	>[K];
};
type MutableFileDiagnostics = {
	-readonly [K in keyof NonNullable<JoinedTargetInput["fileDiagnostics"]>]: NonNullable<
		JoinedTargetInput["fileDiagnostics"]
	>[K];
};
/** A verified package revision. It owns no reader or writer lease and can be reused by targets. */
export interface GameTextProject {
	readonly projectRoot: string;
	readonly cacheRoot: string;
}
export interface GameTextProjectIndex extends GameTextProject {
	readonly generation: string;
	readonly packageKey: string;
	readonly packages: Packages;
	readonly changedFiles?: readonly string[];
}
export interface GameTextTargetImport {
	readonly project: GameTextProject;
	readonly view: GameTextProjectView;
	readonly imported: Imported;
	/** Current layer and observation dependencies, including failed and incrementally reused files. */
	readonly fileKeys: Readonly<Record<string, string | undefined>>;
	readonly fileErrors: NonNullable<JoinedTargetInput["fileErrors"]>;
	readonly fileProvenances: NonNullable<JoinedTargetInput["fileProvenances"]>;
	readonly fileDiagnostics: NonNullable<JoinedTargetInput["fileDiagnostics"]>;
}
export interface GameTextTargetIndex {
	readonly project: GameTextProjectIndex;
	readonly imported: Imported;
	readonly view: GameTextProjectView;
	readonly join: Join;
	readonly review: LocalizationReviewSnapshot;
	readonly generation: string;
	/** Opaque identity for comparing this validated target with an already opened model. */
	readonly queryRevision?: string | undefined;
	readonly fileKeys: GameTextTargetImport["fileKeys"];
}
export interface GameTextIndexModel extends GameTextIndexRefreshResult {
	readonly project: GameTextProjectIndex;
}

const queryRevisionFor = (project: GameTextProject, generation: string, joinedKey: string) =>
	JSON.stringify([project.cacheRoot, project.projectRoot, generation, joinedKey]);

const failure = (operation: string, message: string, recovery: string) =>
	new GameTextIndexError({ operation, message, recovery, retrySafe: true });
const stale = (operation: string) =>
	failure(
		operation,
		"The Game Text index inputs changed between steps.",
		"Refresh the project index and prepare the selected target again."
	);
const packageKey = (manifest: SharedIndexManifest) =>
	createHash("sha256")
		.update(
			encodeWtf8(
				JSON.stringify(
					Object.entries(manifest.active)
						.filter(([name]) => name.startsWith("package-text."))
						.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				)
			)
		)
		.digest("hex");
const configurationFor = (
	cacheRoot: string,
	projectRoot: string,
	targetName?: string
): SharedIndexOptions => ({
	cacheRoot,
	projectKey: projectRoot,
	targetKey: targetName ?? "SavedText",
	projectView:
		targetName === undefined ? { kind: "source" } : { kind: "localization", target: targetName }
});
const checkProject = (project: GameTextProjectIndex, manifest: SharedIndexManifest) =>
	project.generation === manifest.generation && project.packageKey === packageKey(manifest)
		? Effect.void
		: Effect.fail(stale("project"));
const normalizeFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(
		Effect.mapError((cause) =>
			cause instanceof GameTextIndexError ||
			cause instanceof SnapshotStoreError ||
			cause instanceof SnapshotFormatError
				? cause
				: failure("index", String(cause), "Refresh the Game Text index and retry.")
		)
	);
const savedTarget = Schema.decodeUnknownSync(LocalizationTarget)({
	name: "SavedText",
	source: "config_only",
	nativeCulture: null,
	cultures: [],
	configs: [],
	outputPaths: {
		manifest: null,
		archives: {},
		portableObjects: {},
		resources: {},
		locmeta: null,
		wordCount: null,
		conflicts: null
	},
	poFormat: "Unreal",
	collapseMode: "IdenticalTextIdAndSource"
});

export const makeGameTextIndexSteps = (
	cacheRoot: string,
	options: { readonly searchWorker?: boolean; readonly latestSearchOnly?: boolean } = {}
) =>
	Effect.gen(function* () {
		const source = yield* GameTextIndexSource;
		const evidence = yield* LocalizationEvidence;
		const builder = yield* GameTextIndexBuilder;
		const writers = yield* RcMap.make({
			lookup: (_project: string) => Semaphore.make(1),
			capacity: 8
		});
		const projections = yield* Cache.make({
			capacity: 2,
			lookup: (_key: string) => Effect.succeed<JoinedQueryProjection | undefined>(undefined)
		});
		const workers = yield* RcMap.make({
			capacity: 8,
			lookup: (key: string) =>
				Schema.decodeUnknownEffect(
					Schema.fromJsonString(
						Schema.Struct({ input: SearchWorkerInput, instance: Schema.NonEmptyString })
					)
				)(key).pipe(
					Effect.mapError((cause) =>
						failure("search-worker", String(cause), "Rescan the project.")
					),
					Effect.flatMap(({ input }) =>
						makeGameTextSearchWorkerResource(input, {
							latestOnly: options.latestSearchOnly ?? false
						})
					)
				)
		});
		const workerVersions = yield* RcMap.make({
			capacity: 8,
			lookup: (_key: string) => Ref.make(randomUUID())
		});
		const acquireWorker = Effect.fn("GameTextIndex.acquireHealthyWorker")(function* (
			input: SearchWorkerInput
		) {
			const version = yield* RcMap.get(workerVersions, JSON.stringify(input));
			const owner = yield* Effect.scope;
			const rotate = (instance: string) =>
				Ref.update(version, (current) => (current === instance ? randomUUID() : current));
			for (let attempt = 0; attempt < 2; attempt++) {
				const instance = yield* Ref.get(version);
				const pin = yield* Scope.fork(owner);
				const worker = yield* RcMap.get(workers, JSON.stringify({ input, instance })).pipe(
					Effect.provideService(Scope.Scope, pin),
					Effect.tapError((cause) =>
						cause instanceof SnapshotStoreError || cause instanceof SnapshotFormatError
							? rotate(instance)
							: Effect.void
					),
					Effect.onError(() => Scope.close(pin, Exit.void))
				);
				if (worker.healthy()) return worker.search;
				yield* Scope.close(pin, Exit.void);
				// Failed instances retain their existing reader pins under a distinct key. Their
				// eventual cleanup cannot evict the healthy replacement or affect other borrowers.
				yield* rotate(instance);
			}
			return yield* Effect.fail(
				failure(
					"search-worker",
					"The query worker could not stay ready.",
					"Rescan and retry."
				)
			);
		});
		const withSession = <A, E, R>(
			configuration: SharedIndexOptions,
			effect: Effect.Effect<A, E, R>,
			files?: readonly string[]
		) => {
			const request: GameTextIndexBuildSessionRequest = { configuration };
			if (files !== undefined) Object.assign(request, { files });
			return Effect.scoped(
				Effect.gen(function* () {
					const writer = yield* RcMap.get(
						writers,
						sharedIndexDirectory(configuration)
					).pipe(
						Effect.mapError(() =>
							failure(
								"writer",
								"Too many project writers are active.",
								"Wait for a project operation to finish and retry."
							)
						)
					);
					return yield* writer.withPermit(builder.withSession(request, effect));
				})
			).pipe(normalizeFailure);
		};

		const openProject = Effect.fn("GameTextIndex.openProject")(function* (input: {
			readonly projectRoot: string;
		}) {
			const request = yield* Schema.decodeUnknownEffect(
				Schema.Struct({ projectRoot: GameTextIndexRefreshRequest.fields.projectRoot })
			)(input).pipe(
				Effect.mapError((cause) => failure("request", String(cause), "Choose a project."))
			);
			const projectRoot = yield* Effect.tryPromise({
				try: () => realpath(request.projectRoot),
				catch: (cause) =>
					failure(
						"project",
						String(cause),
						"Choose an accessible Unreal project directory."
					)
			});
			return { projectRoot, cacheRoot } satisfies GameTextProject;
		});

		const refreshProject = Effect.fn("GameTextIndex.refreshProject")(function* (
			input: GameTextProjectRefreshRequest
		) {
			const reportProgress = yield* GameTextIndexProgressReporter;
			const request = yield* Schema.decodeUnknownEffect(GameTextProjectRefreshRequest)(
				input
			).pipe(
				Effect.mapError((cause) => failure("request", String(cause), "Choose a project."))
			);
			const { projectRoot } = yield* openProject(request);
			return yield* withSession(
				configurationFor(cacheRoot, projectRoot),
				Effect.gen(function* () {
					const index = yield* SharedIndex;
					reportProgress({ phase: "inventory", completed: 0, total: 0 });
					const inventory =
						request.savedPackages === false
							? []
							: yield* source.inventory({ ...request, projectRoot });
					const byPath = new Map(inventory.map((entry) => [entry.path, entry]));
					const retainedPackages =
						request.savedPackages === false &&
						Object.keys((yield* index.inspect()).active).some((name) =>
							name.startsWith("package-text.")
						);
					const packageRequest = {
						inventory,
						// Stored records carry Unreal's object paths, as the in-memory corpus does.
						read: (paths) =>
							source
								.read(
									projectRoot,
									paths.map((path) => byPath.get(path)!)
								)
								.pipe(
									Stream.map((event) => mountPackageTextEvent(projectRoot, event))
								)
					} satisfies Parameters<typeof refreshPackageTextLayer>[0];
					if (request.changedFiles !== undefined)
						Object.assign(packageRequest, { changedFiles: request.changedFiles });
					const packages = retainedPackages
						? {
								readPackages: 0,
								reusedPackages: 0,
								changedShards: 0,
								removedShards: 0,
								published: false,
								profile: (yield* index.writer()).metrics()
							}
						: yield* Effect.scoped(builder.refreshPackageTextLayer(packageRequest));
					const manifest = yield* index.inspect();
					const result: GameTextProjectIndex = {
						projectRoot,
						cacheRoot,
						packages,
						generation: manifest.generation,
						packageKey: packageKey(manifest)
					};
					if (request.changedFiles !== undefined)
						Object.assign(result, { changedFiles: request.changedFiles });
					return result;
				})
			);
		});

		const importTarget = Effect.fn("GameTextIndex.importTarget")(function* (
			project: GameTextProject,
			input: GameTextTargetImportRequest = {}
		) {
			const request = yield* Schema.decodeUnknownEffect(GameTextTargetImportRequest)(
				input
			).pipe(
				Effect.mapError((cause) =>
					failure("request", String(cause), "Choose a localization target.")
				)
			);
			return yield* withSession(
				configurationFor(cacheRoot, project.projectRoot, request.targetName),
				Effect.gen(function* () {
					const index = yield* SharedIndex;
					if (project.cacheRoot !== cacheRoot)
						return yield* Effect.fail(stale("project"));
					let fileErrors: MutableFileErrors = {};
					let fileProvenances: MutableFileProvenances = {};
					let fileDiagnostics: MutableFileDiagnostics = {};
					if (
						request.changedFiles !== undefined &&
						(yield* index.inspect()).active.joined
					) {
						const previous = yield* Effect.scoped(
							Effect.gen(function* () {
								return yield* readJoinedTarget(yield* index.open(), true);
							})
						);
						yield* checkRetainedImportObservations(previous.meta, request.changedFiles);
						fileErrors = { ...previous.meta.input.fileErrors };
						fileProvenances = { ...previous.meta.input.fileProvenances };
						fileDiagnostics = { ...previous.meta.input.fileDiagnostics };
					}
					const imported =
						request.targetName === undefined
							? {
									target: savedTarget,
									files: [],
									diagnostics: [],
									profile: null
								}
							: yield* Effect.scoped(
									builder.importLocalizationTarget({
										projectRoot: project.projectRoot,
										cacheRoot,
										targetName: request.targetName,
										projectScoped: true
									})
								).pipe(Effect.provideService(LocalizationEvidence, evidence));
					const manifestFailure = imported.diagnostics.find(
						(item) => item.relativePath === imported.target.outputPaths.manifest
					);
					if (request.requireManifest && manifestFailure)
						return yield* Effect.fail(
							new GameTextIndexError({
								operation: "manifest",
								message: manifestFailure.error.message,
								recovery: manifestFailure.error.recovery,
								localizationError: manifestFailure.error
							})
						);
					for (const file of imported.files) {
						delete fileErrors[file.relativePath];
						delete fileDiagnostics[file.relativePath];
						fileProvenances[file.relativePath] = file.provenance;
					}
					for (const diagnostic of imported.diagnostics)
						if (diagnostic.relativePath) {
							fileErrors[diagnostic.relativePath] = diagnostic.error.code;
							fileDiagnostics[diagnostic.relativePath] = diagnostic.error;
							delete fileProvenances[diagnostic.relativePath];
						}
					const fileKeys = yield* observeGameTextImport({
						imported,
						fileErrors,
						fileProvenances,
						fileDiagnostics
					});
					return {
						project,
						view:
							request.targetName === undefined
								? { kind: "source" }
								: { kind: "localization", target: request.targetName },
						imported,
						fileKeys,
						fileErrors,
						fileProvenances,
						fileDiagnostics
					} satisfies GameTextTargetImport;
				}),
				request.changedFiles
			);
		});

		const buildTarget = Effect.fn("GameTextIndex.buildTarget")(function* (
			project: GameTextProjectIndex,
			target: GameTextTargetImport,
			input: GameTextTargetBuildRequest = {}
		): Effect.fn.Return<GameTextTargetIndex, IndexFailure> {
			const request = yield* Schema.decodeUnknownEffect(GameTextTargetBuildRequest)(
				input
			).pipe(
				Effect.mapError((cause) =>
					failure("request", String(cause), "Check the target build options.")
				)
			);
			const { imported } = target;
			if (
				project.cacheRoot !== cacheRoot ||
				project.projectRoot !== target.project.projectRoot
			)
				return yield* Effect.fail(stale("project"));
			return yield* withSession(
				configurationFor(
					cacheRoot,
					project.projectRoot,
					target.view.kind === "source" ? undefined : target.view.target
				),
				Effect.gen(function* () {
					const reportProgress = yield* GameTextIndexProgressReporter;
					const index = yield* SharedIndex;
					const manifest = yield* index.inspect();
					yield* checkProject(project, manifest);
					if (
						Object.entries(target.fileKeys).some(
							([path, key]) => manifest.active[path] !== key
						)
					)
						return yield* Effect.fail(stale("localization"));
					const review = yield* readLocalizationReview({
						projectRoot: project.projectRoot,
						target: imported.target.name
					}).pipe(
						Effect.provide(LocalizationFileAccessLive),
						Effect.catch((cause) =>
							request.tolerateReviewErrors
								? Effect.succeed({
										file: emptyLocalizationReviewFile(imported.target.name),
										relativePath: defaultLocalizationReviewPath(
											imported.target.name
										),
										contentHash: null
									})
								: Effect.fail(cause)
						)
					);
					const joinInput: JoinedTargetInput = {
						force: Boolean(manifest.active["joined.invalidated"]),
						projectRoot: project.projectRoot,
						target: imported.target,
						fileErrors: target.fileErrors,
						fileProvenances: target.fileProvenances,
						fileDiagnostics: target.fileDiagnostics
					};
					if (request.keyChangePairs !== undefined)
						Object.assign(joinInput, { keyChangePairs: request.keyChangePairs });
					if (review.contentHash !== null)
						Object.assign(joinInput, { review: review.file });
					reportProgress({ phase: "joining", completed: 0, total: 0 });
					const join = yield* Effect.scoped(builder.refreshJoinedTarget(joinInput));
					if ((yield* index.inspect()).active["joined.invalidated"])
						yield* (yield* index.writer()).publishBatch([], ["joined.invalidated"]);
					const generation = (yield* index.inspect()).generation;
					return {
						project,
						view: target.view,
						imported,
						fileKeys: target.fileKeys,
						join,
						review,
						generation,
						queryRevision: queryRevisionFor(project, generation, join.key)
					} satisfies GameTextTargetIndex;
				})
			);
		});

		const openTarget = Effect.fn("GameTextIndex.openTarget")(function* (
			target: GameTextTargetIndex
		): Effect.fn.Return<GameTextIndexModel, IndexFailure, Scope.Scope> {
			const reportProgress = yield* GameTextIndexProgressReporter;
			const configuration = configurationFor(
				cacheRoot,
				target.project.projectRoot,
				target.view.kind === "source" ? undefined : target.view.target
			);
			const indexLayer = sharedIndexNodeLayer(configuration);
			const result = {
				imported: target.imported,
				join: target.join,
				review: target.review,
				packages: target.project.packages
			};
			reportProgress({ phase: "opening", completed: 0, total: 0 });
			const joined = yield* openJoinedTarget().pipe(
				Effect.provide(indexLayer),
				normalizeFailure
			);
			yield* checkProject(target.project, joined.reader.manifest);
			if (
				Object.entries(target.fileKeys).some(
					([name, key]) => joined.reader.manifest.active[name] !== key
				)
			)
				return yield* Effect.fail(stale("localization"));
			if (
				joined.reader.manifest.generation !== target.generation ||
				joined.reader.manifest.active.joined !== target.join.key ||
				joined.reader.manifest.active["joined.invalidated"]
			)
				return yield* Effect.fail(stale("target"));
			const projectionKey = `${joined.reader.manifest.generation}:${joined.meta.base ?? joined.reader.manifest.active.joined}`;
			const previousProjection = yield* Cache.get(projections, projectionKey);
			const projection =
				previousProjection &&
				previousProjection.key === joined.reader.manifest.active.joined
					? previousProjection
					: reuseJoinedQueryProjection(joined, previousProjection);
			const reusedColumns = projection.columns.size;
			const reusedSources = Boolean(projection.sourceSeed);
			const queryStarted = performance.now();
			const columnar = yield* Effect.try({
				try: () => columnarTextCorpusQuery(joined, undefined, projection),
				catch: (cause) =>
					failure(
						"query",
						String(cause),
						"Clear the disposable Game Text index and refresh."
					)
			});
			const query = instrumentIndexQuery(columnar);
			const queryPreparationMs = performance.now() - queryStarted;
			yield* Cache.set(projections, projectionKey, projection);
			yield* Effect.annotateCurrentSpan({
				"game_text.index.packages_read": result.packages.readPackages,
				"game_text.index.join_rebuilt": result.join.rebuilt,
				"game_text.index.generation": joined.reader.manifest.generation,
				"game_text.index.query_columns_reused": reusedColumns,
				"game_text.index.query_sources_reused": reusedSources,
				"game_text.index.query_preparation_ms": queryPreparationMs
			});
			const indexedEvidence = yield* readIndexedLocalizationEvidence(joined).pipe(
				Effect.provide(LocalizationFileAccessLive),
				Effect.mapError((cause) =>
					failure("evidence", String(cause), "Refresh the Game Text index and retry.")
				)
			);
			const workerInput = {
				configuration,
				generation: joined.reader.manifest.generation,
				joinedKey: joined.reader.manifest.active.joined!
			};
			// Acquire the worker's reader before exposing the model: later compaction may unlink
			// these files. Overlapping models pin one worker for the same immutable joined view.
			const search = options.searchWorker
				? yield* acquireWorker(workerInput).pipe(
						Effect.mapError((cause) =>
							cause instanceof GameTextIndexError ||
							cause instanceof SnapshotStoreError ||
							cause instanceof SnapshotFormatError
								? cause
								: failure(
										"search-worker",
										"Too many query workers are active.",
										"Wait for active queries to finish and retry."
									)
						)
					)
				: Effect.fn("GameTextIndex.search")((request: TextCorpusSearchRequest) =>
						Effect.try({
							try: () => query.search(request),
							catch: (cause) =>
								failure(
									"query",
									String(cause),
									"Refresh the Game Text index and retry."
								)
						})
					);
			reportProgress({ phase: "ready", completed: 0, total: 0 });
			const corpus = indexedTextCorpus(joined, query);
			return {
				...result,
				project: target.project,
				queryRevision: queryRevisionFor(
					target.project,
					joined.reader.manifest.generation,
					target.join.key
				),
				joined,
				query,
				search,
				evidence: indexedEvidence,
				corpus,
				localizationJoin: indexedLocalizationJoin(joined, query),
				// The scan checks exactly the join's lines, read as rows in the join's order.
				localizationQuality: (options, ruleDocument) =>
					Effect.suspend(() =>
						indexedLocalizationQuality(
							joined,
							corpus,
							indexedEvidence,
							columnar.localizationRows(indexedLocalizationLinesRequest(joined)),
							options,
							ruleDocument
						)
					),
				sourceQuality: (ruleDocument, options) =>
					Effect.suspend(() =>
						indexedSourceQuality(joined, corpus, ruleDocument, options)
					)
			};
		}, normalizeFailure);
		const invalidate = Effect.fn("GameTextIndex.invalidate")(function* (
			request: typeof GameTextIndexRefreshRequest.Type
		) {
			const projectRoot = yield* Effect.tryPromise({
				try: () => realpath(request.projectRoot),
				catch: (cause) =>
					failure("project", String(cause), "Choose an accessible project directory.")
			});
			yield* withSession(
				configurationFor(cacheRoot, projectRoot, request.targetName),
				Effect.gen(function* () {
					const index = yield* SharedIndex,
						writer = yield* index.writer();
					const active = writer.manifest().active;
					const removed = [...(request.changedFiles ?? [])].filter(
						(name) => active[name] !== undefined
					);
					if (active.joined)
						yield* writer.publish("joined.invalidated", `invalidate:${randomUUID()}`, {
							columns: [
								{
									name: "invalidate",
									kind: "bytes",
									load: async () => Uint8Array.of(1)
								}
							]
						});
					if (removed.length) yield* writer.publishBatch([], removed);
				})
			);
		});
		return { openProject, refreshProject, importTarget, buildTarget, openTarget, invalidate };
	});

export class GameTextIndexSteps extends Context.Service<
	GameTextIndexSteps,
	Effect.Success<ReturnType<typeof makeGameTextIndexSteps>>
>()("@ue-shed/game-text/GameTextIndexSteps") {}

export const gameTextIndexStepsLayer = (
	cacheRoot: string,
	options: { readonly searchWorker?: boolean; readonly latestSearchOnly?: boolean } = {}
) => Layer.effect(GameTextIndexSteps, makeGameTextIndexSteps(cacheRoot, options));
