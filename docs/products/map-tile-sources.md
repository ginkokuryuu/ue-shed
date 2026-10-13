# Composable map tile sources

`@ue-shed/cameras` exposes source planning and pixel operations separately from the complete
Map Capture workflow. A host chooses the zooms it renders, the number of tiles each source covers,
the render session policy, loading, retries, concurrency, codecs, storage, and publication. Existing
`MapCapture.run` and CLI defaults retain their individually rendered tile behavior.

Import these pure helpers from `@ue-shed/cameras`, `@ue-shed/cameras/map-tiles`, or
`@ue-shed/cameras/browser`. Each returns `Result<A, MapTileSourceError>` or
`Result<A, MapTileImageError>`. Use `Effect.fromResult` when composing them with Effect services.
The helpers have no filesystem, Unreal, image-codec, or Workbench dependency.

## Source planning

Create a canonical grid with `createMapTileGrid`, then call `planMapTileSources` for an explicit
zoom. `tilesPerSourceSide: 1` gives one source per tile. Four groups sixteen logical tiles into each
source. This is independent of the delivered tile pixel size and does not select or derive any
other zoom. The layout reports counts and exposes a lazy, repeatable, row-major `sources` iterable.
It does not eagerly allocate all source descriptors for a large map.

```ts
import { Effect } from "effect";
import {
	CameraRenderer,
	planMapTileSources,
	cameraRenderContract,
	CameraFrameOperationId
} from "@ue-shed/cameras";

const renderSelectedZoom = Effect.gen(function* () {
	const renderer = yield* CameraRenderer;
	const layout = yield* Effect.fromResult(
		planMapTileSources({
			grid,
			options: {
				zoom: selectedZoom,
				tilesPerSourceSide: hostChoice.tilesPerSourceSide,
				captureZ,
				gutterPixels: 16,
				limits: {
					maximumDimension: supportedRenderer.maximumDimension,
					maximumDecodedBytes: 128 * 1024 * 1024
				}
			}
		})
	);
	const session = yield* renderer.open({ ...sessionRequest, maximumFrames: layout.sourceCount });
	for (const source of layout.sources) {
		const frame = yield* session.capture({
			contract: cameraRenderContract,
			sessionId: session.id,
			operationId: CameraFrameOperationId.make(freshOperationId()),
			camera: source.camera,
			size: source.size
		});
		yield* host.consumeSource({ source, frame });
	}
}).pipe(Effect.scoped);
```

The host supplies the explicitly selected grid, zoom, renderer capability, project/map identity,
operation identifiers, complete session policy and source consumer. Use the shared
[camera-rendering lifecycle](camera-rendering.md) for preflight, native restoration, validated
artifact reads and cancellation. Planning does not open maps or acquire a render session.
Scheduling may overlap CPU processing with the next capture using a bounded stream; source rendering
within a native session remains sequential. Size the host's buffering and crop/encode concurrency
against its total memory budget.

Every descriptor carries its block's first tile and row/column counts, logical world bounds,
orthographic camera, output dimensions, decoded RGBA8 byte count, and per-tile crop rectangles with
exact tile keys/world bounds. The source gutter occurs only around the block's outside edges.
Internal tile borders are adjacent pixels from one screenshot. Non-square grids and partial blocks
at the right/bottom edges use rectangular sources at exactly the same world-units-per-pixel.
Camera width follows world Y; image rows follow max-X toward min-X.

`createMapTileSource` plans one explicit rectangular block instead of enumerating a level. Supply
`{ grid, block: { firstTile, rows, columns }, settings: { captureZ, gutterPixels, limits } }` for
targeted capture or a caller-managed retry. Its crop keys remain the grid's spatial identities;
source operation identity still belongs to the render session.

Both helpers validate the canonical grid and reject invalid regions, dimensions or memory budgets
with typed errors. Limits include the gutter and never silently reduce block size or resolution.
For 1K tiles with 16-pixel gutters, a four-by-four source is **4128×4128**, not 4096×4096.
A sixteen-by-sixteen source with those gutters exceeds the 16K camera contract. Set
`maximumDimension` from the selected renderer's advertised limit and choose a conservative
`maximumDecodedBytes`. The latter bounds **one tightly packed RGBA8 source only**. It is not a GPU
budget or a bound on codec buffers, concurrent sources, crop outputs and retained artifacts.

## Pixel operations

The host decodes an artifact using its chosen image library into `MapTileImage`:
`{ format: "rgba8_srgb", width, height, pixels: Uint8Array }`. Pixels are tightly packed, unpremultiplied
RGB in sRGB plus linear alpha. Encoded PNG/WebP bytes and native BGRA frames are not this format.
The image schema validates dimensions and exact byte length; conversions remain explicit.

`cropMapTileImage(image, source.crops[i].rect)` copies the selected rectangle exactly, including
alpha, into independent storage. It performs no resampling, color matching or seam blending. A host
may instead feed the same rectangles to Sharp or another codec library. The API chooses no codec,
compression level, output filename or storage location.

`deriveMapTileParent(children)` is optional. Supply four equal, even-sized images of at most 4096
pixels per axis, in `mapTileChildren(parentKey)` order: top-left, top-right, bottom-left, bottom-right.
The output has the same dimensions as one child. Each child is reduced two-to-one into its parent
quadrant using a linear-light 2×2 box filter, alpha-weighted color and averaged alpha. Transfer
lookup tables use 16-bit linear precision; byte results can differ by one from floating-point sRGB.
Inputs are preserved. Invalid payloads, crops and child layouts are typed failures.

Callers may derive some levels, derive none, use another filter, or render each level independently.
Per-level rendering can matter for LOD and lighting. Keep camera receipts for rendered sources and
derivation provenance for crops/parents. Do not attach a source camera receipt to a parent as though
Unreal rendered that parent. Publish only after native restoration and the host's coverage,
hashing, image and quality checks succeed.

## Quality and adoption

Larger source footprints reduce camera moves and repeated settling. Lossless crops preserve the
captured pixels; they do not guarantee identical lighting, shadow residency, water, LOD or temporal
history between sources. Frame counts do not certify convergence. Retain the existing independent
tile path when that rendering behavior is required. The
[source-block experiment](../research/map-capture-screenshot-pipeline-2026-10-13.md) records a
six-level timing result alongside shadow-pool overflow and overlap differences. Its subsequent
matched three-level comparison failed visual quality acceptance: a 4K source did not reproduce
sixteen 1K camera views. Neither source dimensions nor fewer capture calls establish equivalent
quality. Follow-up native run-up/resolution experiments recovered detail, and review preferred a
128-native-frame source for the tested overview, with 32 also acceptable. Those settings are private
experimental controls, not new camera-render policy fields. Automatic grouping requires separate
content-specific qualification; these helpers do not select it. No arbitrary CVar overrides or
quality fallback are applied by these helpers. Derive zooms from lossless pixels first; delivery
codecs and any per-zoom quality choices remain host-owned.

The packed-consumer journey is `examples/map-tile-sources/verify.mjs`, run by
`pnpm test:release:packages`. It proves both source strategies, crops, parent derivation and public
entry points without Unreal or Workbench. The focused native test is
`packages/cameras/src/map-tile-source-unreal.integration.test.ts`; supply
`UE_SHED_REMOTE_CONTROL_ENDPOINT` and `UE_SHED_RENDER_FIXTURE_ROOT`. Optional explicit fixture
`UE_SHED_RENDER_FIXTURE_MAP_PATH` and `UE_SHED_RENDER_FIXTURE_PROJECT_NAME` select another generic
rendering project. Run this check on both supported development engine lines.
