import assert from "node:assert/strict";
import { Result, Schema } from "effect";
import {
	createMapTileGrid,
	planMapTileSources,
	cropMapTileImage,
	deriveMapTileParent,
	mapTileChildren,
	mapTileKeyId
} from "@ue-shed/cameras/map-tiles";
import {
	planMapTileSources as rootPlanner,
	CameraRendererPolicy,
	CameraRenderCapabilitiesV1,
	CameraRenderCapabilities,
	cameraRenderContract,
	highResolutionReviewRenderer
} from "@ue-shed/cameras";
import { planMapTileSources as browserPlanner } from "@ue-shed/cameras/browser";

function value(result) {
	if (Result.isFailure(result)) throw result.failure;
	return result.success;
}

const grid = createMapTileGrid({
	requestedBounds: { minX: -3200, minY: -3200, maxX: 3200, maxY: 3200 },
	tilePixelSize: 64,
	coarsestUnitsPerPixel: 100,
	levelCount: 6
});
const options = {
	zoom: 5,
	tilesPerSourceSide: 4,
	captureZ: 10000,
	gutterPixels: 16,
	limits: { maximumDimension: 4096, maximumDecodedBytes: 64 * 1024 * 1024 }
};
assert.equal(rootPlanner, planMapTileSources);
assert.equal(browserPlanner, planMapTileSources);
const rendering = Schema.decodeUnknownSync(CameraRendererPolicy)(
	{
		...highResolutionReviewRenderer,
		screenshotWarmupFrames: 128
	},
	{ onExcessProperty: "error" }
);
assert.equal(rendering.screenshotWarmupFrames, 128);
const legacyCapabilities = {
	contract: cameraRenderContract,
	engineVersion: "fixture-engine",
	pluginVersion: "fixture-plugin",
	projectName: "Fixture",
	renderers: [],
	preparation: [],
	freeze: [],
	maximumRetainedOperations: 64,
	maximumRetainedSessions: 9,
	retentionMs: 120000
};
assert.deepEqual(
	Schema.decodeUnknownSync(CameraRenderCapabilitiesV1)(legacyCapabilities, {
		onExcessProperty: "error"
	}),
	legacyCapabilities
);
const extendedCapabilities = {
	...legacyCapabilities,
	highResolutionScreenshot: { version: 1, maximumWarmupFrames: 256 }
};
assert.deepEqual(
	Schema.decodeUnknownSync(CameraRenderCapabilities)(extendedCapabilities, {
		onExcessProperty: "error"
	}),
	extendedCapabilities
);
assert.equal(
	Schema.decodeUnknownResult(CameraRenderCapabilitiesV1)(extendedCapabilities, {
		onExcessProperty: "error"
	})._tag,
	"Failure"
);
const blocks = value(planMapTileSources({ grid, options }));
const singles = value(planMapTileSources({ grid, options: { ...options, tilesPerSourceSide: 1 } }));
assert.equal(blocks.sourceCount, 64);
assert.equal(singles.sourceCount, 1024);
const source = blocks.sources[Symbol.iterator]().next().value;
assert.ok(source);
const pixels = new Uint8Array(source.decodedBytes);
for (const crop of source.crops) {
	for (let row = crop.rect.top; row < crop.rect.top + crop.rect.height; row++) {
		for (let column = crop.rect.left; column < crop.rect.left + crop.rect.width; column++) {
			const offset = (row * source.size.width + column) * 4;
			pixels.set([crop.key.row * 40, crop.key.column * 40, 100, 255], offset);
		}
	}
}
const decoded = { format: "rgba8_srgb", ...source.size, pixels };
const leaves = new Map();
for (const crop of source.crops) {
	const leaf = value(cropMapTileImage(decoded, crop.rect));
	assert.equal(leaf.width, 64);
	assert.deepEqual(
		[...leaf.pixels.subarray(0, 4)],
		[crop.key.row * 40, crop.key.column * 40, 100, 255]
	);
	leaves.set(mapTileKeyId(crop.key), leaf);
}
const parent = value(
	deriveMapTileParent(
		mapTileChildren({ zoom: 4, row: 0, column: 0 }).map((key) => leaves.get(mapTileKeyId(key)))
	)
);
assert.deepEqual([...parent.pixels.subarray(0, 4)], [0, 0, 100, 255]);
assert.deepEqual([...parent.pixels.subarray(32 * 4, 32 * 4 + 4)], [0, 40, 100, 255]);
assert.deepEqual([...parent.pixels.subarray(32 * 64 * 4, 32 * 64 * 4 + 4)], [40, 0, 100, 255]);
console.log("map-tile-sources-adoption-ok");
