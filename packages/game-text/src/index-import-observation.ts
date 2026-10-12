import { createHash } from "node:crypto";
import { Effect } from "effect";
import { SharedIndex } from "./shared-index.js";
import type { ColdLayerSource } from "./shared-string-sort.js";
import type { GameTextTargetImport } from "./index-steps.js";
import { encodeWtf8 } from "./wtf8.js";

const hash = <Value>(value: Value) =>
	createHash("sha256")
		.update(encodeWtf8(JSON.stringify(value)))
		.digest("hex");
type MutableImportDependencies = {
	-readonly [K in keyof GameTextTargetImport["fileKeys"]]: GameTextTargetImport["fileKeys"][K];
};
const fileObservationName = (path: string) => `localization.observation.${hash(path)}`;
const ordered = <A>(values: Readonly<Record<string, A>>) =>
	Object.entries(values).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

/** Completed observations include failures even when a historical successful layer remains active. */
export const observeGameTextImport = Effect.fn("GameTextIndex.observeImport")(function* (
	input: Pick<
		GameTextTargetImport,
		"imported" | "fileErrors" | "fileDiagnostics" | "fileProvenances"
	>
) {
	const index = yield* SharedIndex;
	const writer = yield* index.writer();
	const active = writer.manifest().active;
	const observations: Record<string, string> = {};
	for (const file of input.imported.files) {
		observations[fileObservationName(file.relativePath)] = hash([
			file.relativePath,
			"read",
			file.key,
			file.provenance
		]);
	}
	for (const diagnostic of input.imported.diagnostics) {
		if (diagnostic.relativePath !== null) {
			observations[fileObservationName(diagnostic.relativePath)] = hash([
				diagnostic.relativePath,
				"failed",
				diagnostic.error.code,
				diagnostic.error.message,
				diagnostic.error.recovery
			]);
		}
	}
	// This pointer belongs to the target view; file observations above are shared across targets.
	observations.imported = hash([
		input.imported.target,
		ordered(input.fileErrors),
		ordered(input.fileDiagnostics).map(([path, error]) => [
			path,
			error.code,
			error.message,
			error.recovery
		]),
		ordered(input.fileProvenances),
		input.imported.diagnostics.filter((diagnostic) => diagnostic.relativePath === null)
	]);
	const entries: ColdLayerSource[] = Object.entries(observations)
		.filter(([name, key]) => active[name] !== key)
		.map(([name, key]) => ({
			name,
			key,
			source: {
				columns: [
					{ name: "observation", kind: "bytes", load: async () => Uint8Array.of(1) }
				]
			}
		}));
	if (entries.length) yield* writer.publishBatch(entries);
	const current = writer.manifest().active;
	const paths = new Set([
		...Object.keys(input.fileProvenances),
		...Object.keys(input.fileErrors)
	]);
	const dependencies: MutableImportDependencies = { imported: current.imported };
	for (const path of paths) {
		dependencies[path] = current[path];
		const name = fileObservationName(path);
		dependencies[name] = current[name];
	}
	return dependencies;
});
