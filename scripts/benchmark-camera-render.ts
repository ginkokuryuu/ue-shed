import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
	CameraFrameOperationId,
	CameraFrameRequest,
	CameraRenderer,
	CameraRenderSessionId,
	CameraRenderSessionRequest,
	cameraRenderContract,
	cameraRendererLayer,
	readCameraFrameArtifact
} from "../packages/cameras/dist/index.js";
import { RemoteControlClientLive } from "../packages/unreal-connection/dist/index.js";
import { Clock, Effect, Layer, Schema } from "effect";

const BenchmarkCase = Schema.Struct({
	name: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/)),
	session: CameraRenderSessionRequest,
	frames: Schema.Array(
		Schema.Struct({
			camera: CameraFrameRequest.fields.camera,
			size: CameraFrameRequest.fields.size
		})
	).check(Schema.isMinLength(1), Schema.isMaxLength(512))
}).check(
	Schema.makeFilter((value) =>
		value.session.maximumFrames >= value.frames.length
			? undefined
			: "The session frame budget must cover every benchmark frame."
	)
);
const Benchmark = Schema.Struct({
	repetitions: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 })),
	cases: Schema.Array(BenchmarkCase).check(Schema.isMinLength(1), Schema.isMaxLength(32))
}).check(
	Schema.makeFilter((value) =>
		new Set(value.cases.map((item) => item.name)).size === value.cases.length
			? undefined
			: "Benchmark case names must be unique."
	)
);

const [inputPath, endpoint, projectRoot, outputPath] = process.argv.slice(2);
if (!inputPath || !endpoint || !projectRoot || !outputPath) {
	throw new Error(
		"Usage: pnpm benchmark:camera-render <cases.json> <endpoint> <project-root> <new-output-directory>"
	);
}
const input = Schema.decodeUnknownSync(Benchmark, { onExcessProperty: "error" })(
	JSON.parse(await readFile(resolve(inputPath), "utf8"))
);
const outputRoot = resolve(outputPath);
await mkdir(dirname(outputRoot), { recursive: true });
await mkdir(outputRoot); // Exclusive: a previous benchmark cannot supply stale evidence.
await writeFile(join(outputRoot, "input.json"), JSON.stringify(input, null, "\t"), {
	flag: "wx"
});
const layer = cameraRendererLayer(endpoint).pipe(Layer.provide(RemoteControlClientLive));

const measure = Effect.fn("CameraBenchmark.measure")(function* (
	benchmarkCase: typeof BenchmarkCase.Type,
	repetition: number
) {
	const renderer = yield* CameraRenderer;
	const session = yield* renderer.open({
		...benchmarkCase.session,
		sessionId: CameraRenderSessionId.make(randomUUID())
	});
	const frames = [];
	for (const [index, frame] of benchmarkCase.frames.entries()) {
		const started = yield* Clock.currentTimeMillis;
		const result = yield* session.capture({
			...frame,
			contract: cameraRenderContract,
			sessionId: session.id,
			operationId: CameraFrameOperationId.make(randomUUID())
		});
		const captured = yield* Clock.currentTimeMillis;
		const artifact = yield* readCameraFrameArtifact({ projectRoot, frame: result });
		const relativePath = `${benchmarkCase.name}-${repetition}-${index}.png`;
		yield* Effect.tryPromise(() =>
			writeFile(join(outputRoot, relativePath), artifact.bytes, { flag: "wx" })
		);
		const stored = yield* Clock.currentTimeMillis;
		frames.push({
			index,
			relativePath,
			contentHash: artifact.contentHash,
			hostCaptureMs: captured - started,
			hostReadAndWriteMs: stored - captured,
			result
		});
	}
	return { name: benchmarkCase.name, repetition, frames };
}, Effect.scoped);

const results: Array<Effect.Success<ReturnType<typeof measure>> & { durationMs: number }> = [];
try {
	for (let repetition = 1; repetition <= input.repetitions; repetition += 1) {
		for (const benchmarkCase of input.cases) {
			const started = performance.now();
			const result = await Effect.runPromise(
				measure(benchmarkCase, repetition).pipe(Effect.provide(layer))
			);
			const durationMs = performance.now() - started;
			results.push({ ...result, durationMs });
			await writeFile(
				join(outputRoot, `${benchmarkCase.name}-${repetition}.json`),
				JSON.stringify({ ...result, durationMs, restoration: "restored" }, null, "\t"),
				{ flag: "wx" }
			);
			console.log(
				`${benchmarkCase.name} #${repetition}: ${result.frames.length} frames in ${(durationMs / 1000).toFixed(2)}s`
			);
		}
	}
	await writeFile(
		join(outputRoot, "report.json"),
		JSON.stringify({ status: "completed", results }, null, "\t"),
		{ flag: "wx" }
	);
} catch (cause) {
	await writeFile(
		join(outputRoot, "report.json"),
		JSON.stringify({ status: "failed", results, failure: String(cause) }, null, "\t"),
		{ flag: "wx" }
	);
	throw cause;
}
