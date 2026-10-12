/** Paired public-API measurements. Inputs are read-only; cold runs own fresh derived caches. */
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Effect, Layer, Schema, Stream } from "effect";
import { assetReaderLayer } from "../packages/unreal-assets/dist/index.js";
import {
	LocalizationEvidenceNodeLive,
	LocalizationTargetName
} from "../packages/localization/dist/index.js";
import { readGeneratedPackageInventory } from "./package-text-generated.ts";
import { killBenchmarkTree } from "./game-text-scale-safety.ts";

const { values } = parseArgs({
	options: {
		project: { type: "string" },
		reader: { type: "string" },
		"before-reader": { type: "string" },
		"before-module": { type: "string" },
		output: { type: "string" },
		cache: { type: "string" },
		records: { type: "string" },
		target: { type: "string" },
		runs: { type: "string", default: "3" },
		worker: { type: "boolean", default: false },
		variant: { type: "string" },
		round: { type: "string" }
	}
});
if (
	!values.project ||
	!values.reader ||
	!values["before-reader"] ||
	!values["before-module"] ||
	!values.output
)
	throw new Error("Provide --project, --reader, --before-reader, --before-module and --output.");
if (values.records && !values.cache)
	throw new Error("Retained records require an existing --cache.");
const runs = Number(values.runs);
if (!Number.isSafeInteger(runs) || runs < 1 || runs > 20) throw new Error("--runs must be 1–20.");
const Result = Schema.Struct({
	variant: Schema.Literals(["before", "after"]),
	round: Schema.Int,
	prepareMs: Schema.Number,
	firstPageMs: Schema.Number,
	readyMs: Schema.Number,
	rssBytes: Schema.Number,
	heapBytes: Schema.Number,
	arrayBufferBytes: Schema.Number,
	readPackages: Schema.Number,
	parsedFiles: Schema.Number,
	total: Schema.Number,
	rows: Schema.Number,
	sha256: Schema.String
});

if (values.worker) {
	const variant = Schema.decodeUnknownSync(Schema.Literals(["before", "after"]))(values.variant);
	const module: typeof import("../packages/game-text/dist/index.js") = await import(
		pathToFileURL(
			resolve(
				variant === "before" ? values["before-module"] : "packages/game-text/dist/index.js"
			)
		).href
	);
	const output = resolve(values.output);
	await mkdir(dirname(output), { recursive: true });
	const cacheRoot = values.cache
		? resolve(values.cache)
		: await mkdtemp(resolve(dirname(output), `${variant}-cache-`));
	const source = values.records
		? Layer.succeed(
				module.GameTextIndexSource,
				module.GameTextIndexSource.of({
					inventory: () =>
						Effect.promise(() =>
							readGeneratedPackageInventory(resolve(values.records!))
						),
					read: () => Stream.die("Retained warm inputs unexpectedly changed.")
				})
			)
		: module.gameTextIndexSourceNodeLayer(cacheRoot);
	const layer = module.gameTextIndexRefreshLayer(cacheRoot).pipe(
		Layer.provide(source),
		Layer.provide(module.typeScriptIndexBuilderLayer),
		Layer.provide(
			assetReaderLayer({
				executable: resolve(variant === "before" ? values["before-reader"] : values.reader)
			})
		),
		Layer.provide(LocalizationEvidenceNodeLive)
	);
	const started = performance.now();
	const result = await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const service = yield* module.GameTextIndexRefresh;
				const targetName = values.target
					? LocalizationTargetName.make(values.target)
					: undefined;
				const opened = yield* service.refresh({
					projectRoot: resolve(values.project!),
					...(targetName ? { targetName } : undefined)
				});
				const prepareMs = performance.now() - started;
				const queryStarted = performance.now();
				const page = opened.query.search({
					query: "",
					capability: "all",
					pageSize: 50,
					...(targetName ? { localization: { target: targetName } } : undefined)
				});
				const firstPageMs = performance.now() - queryStarted;
				const readyMs = performance.now() - started;
				globalThis.gc?.();
				const memory = process.memoryUsage();
				return Result.make({
					variant,
					round: Number(values.round),
					prepareMs,
					firstPageMs,
					readyMs,
					rssBytes: memory.rss,
					heapBytes: memory.heapUsed,
					arrayBufferBytes: memory.arrayBuffers,
					readPackages: opened.packages.readPackages,
					parsedFiles: opened.imported.files.filter((file) => file.parsed).length,
					total: page.total,
					rows: page.units.length,
					sha256: createHash("sha256").update(JSON.stringify(page)).digest("hex")
				});
			})
		).pipe(Effect.provide(layer))
	);
	process.send?.(result);
	process.disconnect?.();
} else {
	const results: (typeof Result.Type)[] = [];
	for (let round = 0; round < runs; round++)
		for (const variant of round % 2 ? ["after", "before"] : ["before", "after"]) {
			const environment = { ...process.env };
			delete environment.NODE_OPTIONS;
			const result = await new Promise<typeof Result.Type>((accept, reject) => {
				const child = fork(
					fileURLToPath(import.meta.url),
					[
						...process.argv.slice(2),
						"--worker",
						"--variant",
						variant,
						"--round",
						String(round)
					],
					{
						execArgv: ["--import", "tsx", "--expose-gc"],
						env: environment,
						detached: process.platform !== "win32",
						stdio: ["ignore", "inherit", "inherit", "ipc"]
					}
				);
				let reply: typeof Result.Type | undefined;
				const timeout = setTimeout(() => {
					void killBenchmarkTree(child).then(
						() => reject(new Error("Benchmark exceeded ten minutes.")),
						reject
					);
				}, 600_000);
				child.on("message", (raw) => {
					try {
						reply = Schema.decodeUnknownSync(Result)(raw);
					} catch (error) {
						reject(error);
					}
				});
				child.once("error", (error) => {
					clearTimeout(timeout);
					reject(error);
				});
				child.once("exit", (code) => {
					clearTimeout(timeout);
					if (code !== 0 || !reply) reject(new Error("Benchmark worker failed."));
					else accept(reply);
				});
			});
			if (results[0] && results[0].sha256 !== result.sha256)
				throw new Error("Before/after page hashes differ.");
			results.push(result);
			const output = resolve(values.output);
			await mkdir(dirname(output), { recursive: true });
			await writeFile(
				output,
				JSON.stringify(
					{
						schemaVersion: 1,
						node: process.version,
						method: "Alternating fresh processes; warm OS caches; checkpoint memory after GC, not sampled peak RSS; first 50-line page hash parity.",
						results
					},
					null,
					"\t"
				) + "\n"
			);
			process.stdout.write(`${variant} ${round + 1}: ${result.readyMs.toFixed(1)} ms\n`);
		}
}
