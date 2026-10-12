import { mkdtemp, mkdir, writeFile, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect, Layer, Stream } from "effect";
import { expect, it } from "vitest";
import {
	makeAssetReaderTestLayer,
	makeProjectIndexTestLayer,
	ProjectIdentity,
	ProjectIndexGeneration,
	ProjectIndexRefreshEvent,
	type ProjectIndexSummary
} from "@ue-shed/unreal-assets";
import { GameTextIndexSource } from "./index-refresh.js";
import { gameTextIndexSourceNodeLayer } from "./index-source-node.js";
import { emptyPackageTextRecord } from "./package-text-record.js";

it.each([true, false])(
	"uses committed signature pages with refresh=%s and verifies sidecars",
	async (refreshProjectIndex) => {
		const root = await mkdtemp(join(tmpdir(), "ue-shed-signature-source-"));
		try {
			await mkdir(join(root, "Content"));
			const path = "Content/Table.uasset",
				absolute = join(root, path),
				sidecar = join(root, "Content/Table.uexp");
			await writeFile(absolute, "package");
			await writeFile(sidecar, "sidecar");
			const stamp = async (file: string) => {
				const value = await stat(file, { bigint: true });
				// Rust's canonical JSON has sorted keys; comparison must not depend on key order.
				return { modifiedMs: Number(value.mtimeNs) / 1_000_000, size: Number(value.size) };
			};
			let signature = JSON.stringify([
				await stamp(absolute),
				await stamp(sidecar),
				null,
				null
			]);
			let summary: ProjectIndexSummary = {
				projectId: ProjectIdentity.make(root),
				generation: ProjectIndexGeneration.make(1),
				packageCount: 1,
				mapCount: 0,
				changedPackages: 1,
				removedPackages: 0,
				completeness: "complete",
				diagnostics: []
			};
			let refreshes = 0,
				reads = 0,
				queries = 0;
			const catalog = makeProjectIndexTestLayer({
				rebuild: () => Stream.die("unused"),
				refresh: () => {
					refreshes++;
					return Stream.succeed(
						ProjectIndexRefreshEvent.cases.Completed.make({ summary })
					);
				},
				status: () => Effect.succeed({ status: "ready", summary }),
				query: (request) => {
					queries++;
					expect(request._tag).toBe("Inventory");
					expect(request.expectedGeneration).toBe(summary.generation);
					return Effect.succeed({
						projectId: summary.projectId,
						generation: summary.generation,
						items: [{ kind: "inventory", packagePath: path, signature }]
					});
				}
			});
			const reader = makeAssetReaderTestLayer({
				discoverAssets: () => Effect.die("second enumeration"),
				discoverTables: () => Effect.die("unused"),
				readAsset: () => Effect.die("unused"),
				readTable: () => Effect.die("unused"),
				source: () => Effect.succeed("configured"),
				scanProject: () => Effect.die("second enumeration"),
				extractProjectTextPackages: (request) => {
					reads++;
					expect(request.paths).toEqual([path]);
					return Stream.succeed(emptyPackageTextRecord(absolute));
				}
			});
			const source = gameTextIndexSourceNodeLayer(root, { refreshProjectIndex }).pipe(
				Layer.provide(Layer.merge(catalog, reader))
			);
			await Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						const service = yield* GameTextIndexSource;
						const inventory = yield* service.inventory({ projectRoot: root });
						expect(refreshes).toBe(refreshProjectIndex ? 1 : 0);
						expect(yield* service.inventory({ projectRoot: root })).toBe(inventory);
						expect(queries).toBe(1);
						const events = Array.from(
							yield* Stream.runCollect(service.read(root, inventory))
						);
						expect(events[0]).toMatchObject({ path });
						expect(reads).toBe(1);
						yield* Effect.promise(() => writeFile(sidecar, "changed sidecar"));
						const failure = yield* Stream.runCollect(
							service.read(root, inventory)
						).pipe(Effect.flip);
						expect(failure.operation).toBe("signature");
						expect(reads).toBe(1);
						summary = { ...summary, generation: ProjectIndexGeneration.make(2) };
						signature = yield* Effect.promise(async () =>
							JSON.stringify([
								await stamp(absolute),
								await stamp(sidecar),
								null,
								null
							])
						);
						const updated = yield* service.inventory({ projectRoot: root });
						expect(queries).toBe(2);
						expect(updated).not.toBe(inventory);
						yield* Stream.runDrain(service.read(root, updated));
						expect(reads).toBe(2);
					})
				).pipe(Effect.provide(source))
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}
);
