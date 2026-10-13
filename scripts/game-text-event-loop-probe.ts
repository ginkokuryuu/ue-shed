/** Event-loop responsiveness probe for a cold Game Text refresh, using the layers a server host
 * composes: `gameTextIndexRefreshLayer(cache, { searchWorker, latestSearchOnly })` over
 * `gameTextIndexSourceNodeLayer` and `typeScriptIndexBuilderLayer`. The Project Index and native
 * reader are replaced by in-memory synthetic adapters; everything above them is production code.
 * Synthetic data only. No Unreal, no native reader, no studio project.
 *
 *   pnpm build:typescript-packages
 *   pnpm probe:game-text-event-loop --scale 0.3 --assets 450000
 *
 * Options: --no-warm, --no-corpus-units (skip the host-side unit materialisation step),
 * --no-reader-json (skip modelled protocol decoding), --no-profile, --keep-cache,
 * --interval/--record (timer and recorded gap thresholds, ms), --output <report.json>.
 * The localization project is generated once under --root and reused; caches are fresh per run.
 * Gaps are attributed twice: CPU samples name the synchronous functions, and Effect spans name the
 * operation when work runs in promise continuations whose CPU stacks lose their callers.
 */
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { Context, Effect, Exit, Layer, Schema, Scope, Stream, Tracer } from "effect";
import * as gameText from "../packages/game-text/dist/index.js";
import * as assets from "../packages/unreal-assets/dist/index.js";
import * as localization from "../packages/localization/dist/index.js";
import {
	gameTextScaleEvents,
	gameTextScaleRecipe,
	generateGameTextScale
} from "./localization-scale-data.ts";
import { positiveNumber, repositoryPath, repositoryRoot } from "./game-text-scale-options.ts";
import {
	attributeGaps,
	attributeSpans,
	blockingOwners,
	spanRecorder,
	startCpuProfile,
	startEventLoopProbe
} from "./event-loop-probe.ts";

// Attribution maps compiled dist frames back to TypeScript through the emitted source maps.
if (!process.sourceMapsEnabled)
	throw new Error("Run with node --enable-source-maps so frames map to package sources.");

const { values } = parseArgs({
	allowNegative: true,
	options: {
		scale: { type: "string", default: "0.3" },
		assets: { type: "string", default: "450000" },
		seed: { type: "string", default: "57" },
		root: { type: "string", default: "test-results/game-text-event-loop" },
		interval: { type: "string", default: "20" },
		record: { type: "string", default: "50" },
		"sampling-interval": { type: "string", default: "1000" },
		profile: { type: "boolean", default: true },
		"reader-json": { type: "boolean", default: true },
		warm: { type: "boolean", default: true },
		"corpus-units": { type: "boolean", default: true },
		"keep-cache": { type: "boolean", default: false },
		output: { type: "string" }
	}
});
const scale = positiveNumber(values.scale, "scale");
const seed = Number(values.seed);
const intervalMs = positiveNumber(values.interval, "interval");
const recordMs = positiveNumber(values.record, "record");
const samplingUs = positiveNumber(values["sampling-interval"], "sampling-interval");
const root = repositoryPath(values.root);
const recipe = gameTextScaleRecipe(scale);
const assetCount = Math.max(recipe.packages, Math.round(positiveNumber(values.assets, "assets")));
const log = (message: string) => process.stdout.write(`${message}\n`);

// ---- Preparation (not probed) ----------------------------------------------------------------
await mkdir(root, { recursive: true });
const projectRoot = join(root, `project-${scale}x-seed${seed}`);
if (!(await stat(join(projectRoot, "scale.json")).catch(() => undefined))) {
	log(`Generating synthetic localization target in ${projectRoot}`);
	await generateGameTextScale({ root: projectRoot, scale, seed, savedText: false });
}
const prepared = performance.now();
type PackageEvent = typeof assets.SavedAssetPackageTextEvent.Type;
const records = new Map<string, PackageEvent>();
for (const event of gameText.packageTextRecordsFromEvents(gameTextScaleEvents(recipe, seed)))
	if (event.event === "text_package_record") records.set(event.path, event);
const textHeader = {
	packageFlags: 0x40000,
	gatherableTextDataCount: 0,
	gatherableTextDataOffset: 0,
	hasTextProperty: true
};
const plainHeader = { ...textHeader, packageFlags: 0, hasTextProperty: false };
// Every package and sidecar is absent on disk, so the source's stat verification matches.
const signature = JSON.stringify([null, null, null, null]);
interface InventoryRow {
	readonly kind: "inventory";
	readonly packagePath: string;
	readonly signature: string;
	readonly headerData: typeof textHeader;
}
const inventory: InventoryRow[] = [];
for (const path of records.keys()) {
	const index = Number(/Package(\d+)\.uasset$/u.exec(path)?.[1]);
	inventory.push({
		kind: "inventory",
		packagePath: path,
		signature,
		headerData: index < recipe.textPackages ? textHeader : plainHeader
	});
}
for (let index = inventory.length; index < assetCount; index++)
	inventory.push({
		kind: "inventory",
		packagePath: `Content/Lumeko/Props/Batch${Math.floor(index / 1000)}/Prop${index}.uasset`,
		signature,
		headerData: plainHeader
	});
// Reader output crosses a process pipe as JSON in production; decode it on this thread too.
const lines = new Map<string, string>();
if (values["reader-json"])
	for (const [path, record] of records) lines.set(path, JSON.stringify(record));
const decodeEvent = Schema.decodeUnknownSync(assets.SavedAssetPackageTextEvent);
let occurrences = 0;
for (const record of records.values())
	if (record.event === "text_package_record") occurrences += record.occurrences.length;
log(
	`Prepared ${inventory.length} inventory rows, ${recipe.textPackages} text packages, ` +
		`${occurrences} occurrences, ${recipe.keys} keys x ${recipe.cultures.length} cultures ` +
		`in ${((performance.now() - prepared) / 1000).toFixed(1)} s`
);
globalThis.gc?.();

// ---- Synthetic adapters below the production source layer ----------------------------------
const summary = {
	projectId: assets.ProjectIdentity.make(projectRoot),
	generation: assets.ProjectIndexGeneration.make(1),
	packageCount: inventory.length,
	mapCount: 0,
	changedPackages: inventory.length,
	removedPackages: 0,
	completeness: "complete" as const,
	diagnostics: []
};
const projectIndex = assets.makeProjectIndexTestLayer({
	rebuild: () => Stream.die("The probe does not rebuild the Project Index."),
	refresh: () => Stream.die("The probe uses a committed Project Index."),
	status: () => Effect.succeed({ status: "ready" as const, summary }),
	// Each page is a process round trip that the adapter validates on the host thread.
	query: (request) => {
		const start = request.cursor === undefined ? 0 : Number(request.cursor),
			end = Math.min(inventory.length, start + request.limit);
		return Effect.promise(() => new Promise((accept) => setImmediate(accept))).pipe(
			Effect.andThen(
				assets.decodeProjectIndexPage({
					projectId: summary.projectId,
					generation: summary.generation,
					items: inventory.slice(start, end),
					...(end < inventory.length ? { nextCursor: String(end) } : undefined)
				})
			),
			Effect.orDie
		);
	}
});
const reader = assets.makeAssetReaderTestLayer({
	discoverAssets: () => Effect.die("unused"),
	discoverTables: () => Effect.die("unused"),
	readAsset: () => Effect.die("unused"),
	readTable: () => Effect.die("unused"),
	source: () => Effect.succeed("configured"),
	scanProject: () => Effect.die("The probe never enumerates packages."),
	extractProjectTextPackages: (request) =>
		Stream.fromAsyncIterable(
			(async function* () {
				let chunk = 0;
				for (const path of request.paths ?? []) {
					const line = lines.get(path);
					const record =
						line === undefined ? records.get(path) : decodeEvent(JSON.parse(line));
					if (!record) throw new Error(`Synthetic package ${path} is absent.`);
					yield record;
					// Pipe chunks arrive as separate I/O callbacks.
					if (++chunk % 16 === 0) await new Promise((accept) => setImmediate(accept));
				}
			})(),
			(cause) => {
				throw cause;
			}
		)
});

// ---- Probe ------------------------------------------------------------------------------------
const probe = startEventLoopProbe({ intervalMs, recordMs });
const recorder = spanRecorder();
const profiler = values.profile ? await startCpuProfile(samplingUs) : undefined;
const state = { run: "layer", progress: "", builder: "" };
const label = () =>
	probe.stage([state.run, state.progress, state.builder].filter(Boolean).join("/"));
const setRun = (name: string) => {
	Object.assign(state, { run: name, progress: "", builder: "" });
	label();
};
const reportProgress = (progress: typeof gameText.GameTextIndexProgress.Type) => {
	state.progress = progress.phase;
	label();
};
const staged = <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) =>
	Effect.suspend(() => {
		state.builder = name;
		label();
		return effect;
	}).pipe(
		Effect.ensuring(
			Effect.sync(() => {
				state.builder = `after-${name}`;
				label();
			})
		)
	);
const builder = Layer.effect(
	gameText.GameTextIndexBuilder,
	Effect.gen(function* () {
		const original = yield* gameText.GameTextIndexBuilder;
		return gameText.GameTextIndexBuilder.of({
			...original,
			importLocalizationTarget: (request) =>
				staged("localization", original.importLocalizationTarget(request)),
			refreshPackageTextLayer: (request) =>
				staged("packages", original.refreshPackageTextLayer(request)),
			refreshJoinedTarget: (request) => staged("join", original.refreshJoinedTarget(request))
		});
	}).pipe(Effect.provide(gameText.typeScriptIndexBuilderLayer))
);
const cacheRoot = join(root, `cache-${Date.now()}`);
const indexLayer = gameText
	.gameTextIndexRefreshLayer(cacheRoot, { searchWorker: true, latestSearchOnly: true })
	.pipe(
		Layer.provide(
			gameText
				.gameTextIndexSourceNodeLayer(cacheRoot, { refreshProjectIndex: false })
				.pipe(Layer.provide(Layer.merge(projectIndex, reader)))
		),
		Layer.provide(builder),
		Layer.provide(localization.LocalizationEvidenceNodeLive)
	);
const run = <A, E>(effect: Effect.Effect<A, E>) =>
	Effect.runPromise(effect.pipe(Effect.provideService(Tracer.Tracer, recorder.tracer)));
const timings: Record<string, number> = {};
const timed = async <A>(name: string, task: () => Promise<A>) => {
	setRun(name);
	const started = performance.now();
	try {
		return await task();
	} finally {
		timings[name] = performance.now() - started;
		log(`${name}: ${(timings[name] / 1000).toFixed(2)} s`);
	}
};
const rootScope = await run(Scope.make());
const target = localization.LocalizationTargetName.make("Generated");
const searchRequest = {
	query: "",
	capability: "all" as const,
	pageSize: 50,
	localization: { target, culture: localization.CultureCode.make(recipe.cultures[1]!) }
};
let failure: unknown;
try {
	const context = await timed("layer", () => run(Layer.buildWithScope(indexLayer, rootScope)));
	const service = Context.get(context, gameText.GameTextIndexRefresh);
	const refresh = (scope: Scope.Scope) =>
		run(
			service
				.refresh({ projectRoot, targetName: target })
				.pipe(
					Effect.provideService(gameText.GameTextIndexProgressReporter, reportProgress),
					Effect.provideService(Scope.Scope, scope)
				)
		);
	const searches = async (prefix: string, result: Awaited<ReturnType<typeof refresh>>) => {
		await timed(`${prefix}:search-first`, () => run(result.search(searchRequest)));
		await timed(`${prefix}:search-text`, () =>
			run(result.search({ ...searchRequest, query: "mirava" }))
		);
		await timed(`${prefix}:search-facets`, () =>
			run(
				result.search({
					...searchRequest,
					facets: { folder: "", assets: true, origins: true, cultures: true }
				})
			)
		);
	};
	const coldScope = await run(Scope.make());
	const cold = await timed("cold", () => refresh(coldScope));
	log(`cold: ${cold.packages.readPackages} packages read, join rebuilt=${cold.join.rebuilt}`);
	await searches("cold", cold);
	// Some hosts spread the retained corpus, which materialises every unit on this thread.
	if (values["corpus-units"])
		await timed("host:corpus-units", async () => cold.corpus.units.length);
	await timed("cold:release", () => run(Scope.close(coldScope, Exit.void)));
	if (values.warm) {
		const warmScope = await run(Scope.make());
		const warm = await timed("warm", () => refresh(warmScope));
		await searches("warm", warm);
		await timed("warm:release", () => run(Scope.close(warmScope, Exit.void)));
	}
} catch (cause) {
	failure = cause;
} finally {
	await run(Scope.close(rootScope, Exit.void)).catch((cause) => (failure ??= cause));
}
setRun("done");
const measured = probe.stop();
const profile = await profiler?.stop();
if (!values["keep-cache"]) await rm(cacheRoot, { recursive: true, force: true });
if (failure) {
	console.error(failure);
	process.exitCode = 1;
}

// ---- Report -----------------------------------------------------------------------------------
const longest = [...measured.gaps].sort((left, right) => right.ms - left.ms);
const attributed =
	profile && profiler
		? attributeGaps({
				profile,
				markerMs: profiler.markerMs,
				gaps: longest.filter((gap) => gap.ms >= 100).slice(0, 40),
				repositoryRoot
			})
		: undefined;
const spanned = attributeSpans(
	recorder.spans,
	longest.filter((gap) => gap.ms >= 100).slice(0, 40),
	performance.now()
);
const report = {
	schemaVersion: 1,
	node: process.version,
	method:
		`setInterval(${intervalMs} ms) gaps >= ${recordMs} ms; monitorEventLoopDelay(10 ms); ` +
		`in-process V8 sampling profile every ${samplingUs} us, aligned by a marker.`,
	corpus: {
		scale,
		seed,
		inventory: inventory.length,
		textPackages: recipe.textPackages,
		occurrences,
		keys: recipe.keys,
		cultures: recipe.cultures.length,
		readerJson: values["reader-json"]
	},
	timingsMs: timings,
	maxGapMs: measured.maxTickMs,
	histogram: measured.histogram,
	stages: measured.stages,
	gaps: longest,
	attribution: attributed,
	spans: spanned,
	owners: attributed ? blockingOwners(attributed.gaps) : undefined
};
const output = resolve(values.output ?? join(root, `report-${scale}x-${Date.now()}.json`));
await writeFile(output, JSON.stringify(report, null, "\t") + "\n");
const fixed = (value: number) => value.toFixed(0).padStart(6);
log(
	`\nmax gap ${measured.maxTickMs.toFixed(0)} ms; loop delay p50 ` +
		`${measured.histogram.p50Ms.toFixed(1)} p99 ${measured.histogram.p99Ms.toFixed(1)} ` +
		`max ${measured.histogram.maxMs.toFixed(0)} ms`
);
log("\nstage                                       wall ms  max gap  p99 gap  >=100ms  blocked");
for (const item of measured.stages.filter((value) => value.wallMs >= 1))
	log(
		`${item.stage.padEnd(42)} ${fixed(item.wallMs)}   ${fixed(item.maxGapMs)}   ` +
			`${fixed(item.p99GapMs)}   ${String(item.gapsOver100Ms).padStart(6)}  ` +
			fixed(item.blockedMs)
	);
log("\nlongest gaps");
for (const gap of attributed?.gaps.slice(0, 12) ?? []) {
	log(`${fixed(gap.gap.ms)} ms  ${gap.gap.stage} (${gap.gap.startStage} -> ${gap.gap.endStage})`);
	const span = spanned.find((item) => item.ms === gap.gap.ms);
	if (span?.span) log(`          span ${span.span}`);
	for (const owner of gap.owners.slice(0, 3))
		log(
			`          ${fixed(owner.ms)} ms  ${owner.frame}` +
				(owner.chain ? `\n                     < ${owner.chain}` : "")
		);
}
if (!attributed)
	for (const gap of longest.slice(0, 12))
		log(`${fixed(gap.ms)} ms  ${gap.stage} (${gap.startStage} -> ${gap.endStage})`);
log(`\nReport: ${output}`);
