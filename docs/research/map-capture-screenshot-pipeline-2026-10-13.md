# Revisiting the map screenshot pipeline — 2026-10-13

## Finding

The default Lit map backend already calls Unreal's `FViewport::TakeHighResScreenShot` for every
tile. Its remaining cost and fidelity differences come from the surrounding workflow: repeated
camera moves, a fixed 128-frame warmup per tile, separately rendered zoom levels, explicit exposure
and post-process choices, and repeated PNG processing. Replacing SceneCapture with a custom renderer
is not required to investigate a faster default.

Larger source captures reduce repeated rendering, but the first matched three-level comparison on a
complex map **failed visual quality acceptance**. Follow-up experiments recovered substantial detail
by increasing the native screenshot's final-resolution run-up or controlling viewport resolution.
Review then preferred the 128-frame native result for the overview use case, with 32 native frames
also acceptable. This qualifies those specific images for that use case, not pixel equivalence or
an automatic strategy for arbitrary worlds. Lossless slicing cannot recover detail that was never
rendered. Keep source grouping explicit, and qualify resolution and settling together before adopting
it. Do not lower the default warmup merely because a simple scene tolerates fewer frames.

This investigation adds a repeatable headless benchmark and local source-block comparisons. It does
not change existing capture defaults or claim that the adopter's reported hour-long run was reproduced.

## Source comparison

Inspected installed UE 5.7.4 and 5.8.3, plus the local adopter's 5.8.2 engine source. The relevant
behavior is consistent across these versions. Engine entry points are relative to `Engine/Source`:

- `Runtime/Engine/Private/UnrealClient.cpp`: `TakeHighResScreenShot`, `HighResScreenshot`.
- `Runtime/Engine/Private/ShowFlags.cpp`: high-resolution screenshot show-flag overrides.
- `Runtime/Core/Private/HAL/ConsoleManager.cpp`: screenshot delay registration with default four.
- `Runtime/Renderer/Private/SceneCaptureRendering.cpp`: independent SceneCapture view initialization.

Repository entry points:

- [Lit tile adapter](../../unreal/Plugins/UEShedCameras/Source/UEShedCamerasEditor/Private/UEShedLitMapTileCapture.cpp)
  supplies 512 overview/metering frames once, 128 settling frames per tile, a shared exposure and an
  owned material/tick freeze.
- [Shared renderer](../../unreal/Plugins/UEShedCameras/Source/UEShedCamerasEditor/Private/UEShedCameraRenderSession.cpp)
  explicitly draws the editor viewport during settling, sets the requested screenshot resolution,
  and calls `TakeHighResScreenShot`. Its frame evidence includes rendering, screenshot completion
  and native PNG validation time; it does not isolate GPU, warmup and encoding separately.
- [Host workflow](../../packages/cameras/src/map-tile-capture.ts) enumerates every requested zoom
  level, captures in sequential four-tile Lit batches, and overlaps ingestion with the next batch.
- [Whole-level experiment](../../unreal/Plugins/UEShedCameras/Source/UEShedCamerasEditor/Private/UEShedMapTileCapture.cpp)
  uses the same renderer for a complete level and slices its image. The host/request limits permit
  at most 64 tiles per level, so a five-level 1×1-base pyramid cannot use it at the finest level.

`TakeHighResScreenShot` schedules a capture and rejects dimensions above the RHI texture limit.
`HighResScreenshot` creates one full-size dummy viewport, disables motion blur, forces `r.ForceLOD=0`,
optionally selects 128-bit color buffers, renders the configured `r.HighResScreenshotDelay` frames
(default/fallback four), flushes rendering work, and processes the screenshot. It then restores its
overrides and releases the viewport. UE 5.8 changes viewport ownership/resource handling, without
removing this repeated rendering sequence.

Our 128 frames happen **before** this native sequence, at the ordinary viewport resolution. They
are not 128 samples at the PNG's requested resolution. They can help scene residency and histories,
but cannot certify convergence of the subsequent full-resolution view. Evidence explicitly says
`convergence: not_assessed`. The returned 129 frames in recent tile runs include an additional
viewport draw while completing the pending screenshot; native screenshot run-up frames are not
included in that counter.

Reducing `r.HighResScreenshotDelay` below four also disables temporal AA through Unreal's show-flag
override. The benchmark varies our outer settling policy, leaving the native delay alone.

The old independent SceneCapture path really has different image formation. Without inherited
main-view post processing, Unreal initializes capture views with Lumen GI/reflections disabled and
surface-cache resolution set to half, before applying component/project overrides. The screen-trace
disabling in that source branch specifically applies to cube captures, not ordinary SceneCapture2D
tiles. The current Lit backend uses the editor camera renderer. Gutters cannot make separate camera
footprints and lighting histories equal.

## What previous research established

The [September quality audit](map-capture-quality-2026-09-06.md) inspected the 5.7 engine path and
recommended a master image plus derived levels. The
[moving-camera experiment](map-capture-moving-camera-2026-09-07.md) then recovered useful Lit shadow
detail and established the moving-camera alternative. It compared 128 with 512 settling frames;
512 did not materially improve overlap agreement. It did not establish that 128 was the minimum
needed. The [32×32 run](map-capture-grid32-2026-09-07.md) already generated a derived pyramid in its
private experiment, but that derivation did not become the shipped map-run workflow.

## Evidence from an adopter

Read existing immutable runs without changing plans, captures or project assets. The retained
recent runs contain 85 tiles across four levels; no retained complete 341-tile Lit run was found
in the inspected installations. Private project/map identities and source paths stay in ignored
local evidence.

| Retained run               | Published duration | Sum of per-tile camera-operation time | Remainder |
| -------------------------- | -----------------: | ------------------------------------: | --------: |
| 2026-10-12, larger extent  |          479.613 s |                     462.843 s (96.5%) |  16.770 s |
| 2026-10-12, smaller extent |          240.957 s |                     223.201 s (92.6%) |  17.756 s |
| 2026-10-07                 |          285.934 s |                     270.588 s (94.6%) |  15.346 s |

The camera-operation sum includes native screenshot/PNG work as well as settling; the remainder
includes cropped-tile processing, batch scheduling, ingestion and publication. These figures do
not isolate a particular renderer subsystem. They do make host filesystem/publication work a weak
primary target for this workload. The first tile includes the overview/metering stage.

A five-level pyramid starting at 1×1 contains 1 + 4 + 16 + 64 + 256 = **341** tiles. Current settling
requests at least 43,648 per-tile viewport frames plus the initial 512 overview frames, before
native screenshot run-up and completion. Wall time depends on actual viewport cadence and scene
cost, so this is not a prediction of the reported hour-long run.

Capturing only the finest level removes 85 render operations (24.9%). Grouping its sixteen-by-sixteen
leaf grid into 4×4-leaf blocks needs only 16 source screenshots, or four source screenshots with
8×8-leaf blocks. A suitable single 16K master needs one. All strategies still produce the same 341
logical tile files; they change how source pixels and lower levels are generated.

## Reproducible benchmark

[benchmark-camera-render.ts](../../scripts/benchmark-camera-render.ts) uses the public scoped
camera-render API and validated artifact reader. It accepts complete policies and explicit cameras
and sizes, assigns fresh operation/session identities, writes PNGs and raw rendering evidence,
records host capture and artifact-copy times, and requires restoration before recording a
successful case. An existing output directory is rejected. Failed cases retain a failed report.
The script never opens a map implicitly or changes saved project content.

```powershell
pnpm --filter @ue-shed/cameras... build
pnpm benchmark:camera-render cases.json http://localhost:30010 /path/to/project /new/output
```

The input is `{ repetitions, cases }`. Each case has a unique filesystem-safe `name`, a complete
`CameraRenderSessionRequest` as `session`, and `frames: [{ camera, size }]`. Frame fields use the
existing camera-render schemas. See [camera rendering](../products/camera-rendering.md) for the
session/policy contract. Repetition order is recorded; this is an exploratory benchmark, not a
randomized experiment proving convergence.

Local evidence is under ignored `out/camera-render-audit-2026-10-13/`. Owned disposable editors load
the stock template map. Six transient asymmetric engine shapes add elevated geometry and shadows
for the second 5.7 run and the 5.8 comparison. Fixed EV100, Lit rendering, disabled vignette/fog,
and material/tick freezing are shared across cases. The GPU is an RX 7900 XT with D3D12. Each case
runs twice through the asynchronous public API. These timings include native PNG creation, host
artifact validation/copy, and successful session close, but not editor startup.

The equal-detail grid comparison covers one 4K×4K image: sixteen 1056×1056 source captures with
16-pixel gutters, four 2080×2080 captures with the same outer gutter, or one 4096×4096 master.
Every source keeps the same 128-frame settling requirement. Raw source tiles are cropped exactly;
no seam blending or color matching is applied. A separate 8K master tests a larger supported size.

The host prototype slices a 4K master into sixteen 1K leaves, then makes four 1K parents and one 1K
root using a linear-light 2×2 box reduction with 16-bit transfer lookup tables and opaque RGB output.
Its encode concurrency is four and PNG compression is lossless level one. This is measured CPU
work, not a published production manifest.

### Results

Means of two repetitions with the asymmetric geometry/shadow scene:

| Same 4K coverage and detail, 128 outer frames per source | UE 5.7.4 | UE 5.8.3 |
| -------------------------------------------------------- | -------: | -------: |
| Sixteen 1K tile screenshots                              |  52.05 s |  51.70 s |
| Four 2K block screenshots                                |  14.78 s |  14.23 s |
| One 4K master screenshot                                 |   5.11 s |   4.83 s |
| CPU slice/encode sixteen leaves                          |  0.069 s |  0.064 s |
| CPU derive/encode five lower-level tiles                 |  0.145 s |  0.142 s |

The master plus CPU work is about **10× faster** in this scene while retaining the 128-frame
settling policy. The four-block strategy is approximately 3.5–3.6× faster. The 8K screenshot
completed in 10.26 s on 5.7 and 10.36 s on 5.8. A 16K screenshot was **not** attempted; its VRAM
cost is not established by these runs. These are qualified scene-local measurements, not promised
speedups for a large production world. They omit the adopter's once-per-run overview/metering stage
and do not benchmark the production map-run publication contract.

Outer warmup sweep, four 1K camera views per case:

| Requested outer frames per view | UE 5.7.4 | UE 5.8.3 |
| ------------------------------- | -------: | -------: |
| 128                             |  13.33 s |  12.93 s |
| 64                              |   7.06 s |   6.94 s |
| 32                              |   3.88 s |   3.87 s |
| 16                              |   2.29 s |   2.31 s |
| 8                               |   1.41 s |   1.41 s |
| 4                               |   0.97 s |   0.90 s |

Lower warmup values produce measurable pixel changes. On matched repeated camera positions,
32 versus 128 averaged 1.00 RGB levels on 5.7 and 1.23 on 5.8; four versus 128 averaged 1.41
and 1.82 respectively, with a 5.8 sample reaching 3.11. The sweep uses evolving renderer state and
is not randomized, so those differences do not isolate warmup length as the only cause. It also
does not prove that four or 32 frames preserve complex-world residency and lighting quality.

At matching 4K dimensions, a repeated whole-view screenshot differs by 0.57/255 mean absolute RGB
on 5.7 and 0.78/255 on 5.8. The exact-cropped sixteen-tile assembly differs from the master by
1.43/255 and 1.97/255 respectively; four-block assemblies differ by 2.30/255 and 1.80/255. These
whole-image errors include real view-dependent lighting and temporal variation, not just seams.
They are not perceptual pass/fail scores. Visual inspection confirms orientation, the asymmetric
geometry, elevated shadows and complete coverage in both master and assembled outputs. Matching
the same renderer does not imply byte-identical pixels across separate camera footprints.

### Verification and remaining qualification

- Plugin builds passed on UE **5.7.4** and **5.8.3**.
- Both versions completed **92** scoped camera captures each with asymmetric geometry, validated PNG
  dimensions/signatures and hashes, and successful session restoration. An additional 92-capture
  simple-template baseline completed on 5.7. Raw requests, receipts, images and timing reports are
  retained locally.
- For each of the three runs, all 21 derived PNGs decode at 1024×1024, and every RGB pixel of all
  sixteen derived leaves equals an independent crop from the original master. Slicing preserves
  the captured finest-detail pixels exactly.
- `pnpm run check:precommit` passed: formatting, lint, type checks, StyleX, 43 architecture tests,
  and contract parity. Lint emits existing warnings outside the new harness.
- Disposable editors were stopped after rendering. Creating test geometry dirtied their in-memory
  worlds; every render preserves its observed dirty state. No engine map or adopter asset was saved.
- Full `pnpm check`, full native automation, a 16K memory test, and a fresh matched capture through
  the adopter's existing per-tile workflow were not run. The historical adopter runs are read-only
  timing evidence. The following experiment exercises a complex map through source blocks;
  product defaults remain as shipped.

## Six-level source-block experiment

An explicitly requested local experiment used the adopter's saved smaller-extent overview bounds
and capture height, extending a copy of its plan to six levels. The saved plan and map assets were
not changed. No five-level per-tile comparison was run. Private identities, requests, source PNGs,
receipts, derived tiles and reports remain under ignored `out/map-block-six-level-2026-10-13/`.

The rendering editor ran hidden with `-RenderOffscreen`, using the adopter's matching UE **5.8.2**
engine and installed camera plugin **0.10.0**. It still renders with D3D12 and calls the built-in
high-resolution screenshot function. It retains the existing 512-frame shared overview/metering
stage, 128 outer frames per source, exposure lock, disabled vignette and fog, and scoped material/tick
freeze. Geometry loading is preserved; this run does not independently certify unloaded partition
actors. No project configuration or source assets were saved.

The logical finest image is 32,768×32,768 pixels: 32×32 individual 1024×1024 leaves at approximately
13.33 cm/pixel. An 8×8 source grid groups four-by-four leaves in each screenshot. Each source is
4128×4128, including a 16-pixel gutter around its 4096-pixel logical interior. Exactly 64 screenshots
produce 1024 lossless crops. CPU linear-light, premultiplied-alpha reduction produces another 341
parent tiles, giving **1365 tiles across six levels**. No complete 32K raster is allocated.

Capture runs serially through one scoped public `CameraRenderer` session. A one-item stream buffer
overlaps the next screenshot with cropping and encoding the previous source; encode concurrency is
four and Sharp concurrency is two. Lower levels are generated after native restoration succeeds.
Every tile is retained as lossless PNG and encoded separately as WebP at quality 90, alpha quality
100 and effort four, matching the adopter's delivery settings. Viewer requests remain individual 1K
files. The standard complete pyramid manifest records derived tile bounds, dimensions and hashes;
separate source receipts and derivation proofs describe the experiment rather than pretending that
Unreal rendered each parent independently. Output stays local and is not published through the
adopter application.

| Measured stage                                         |                  Duration |
| ------------------------------------------------------ | ------------------------: |
| 64 source captures plus overlapping leaf PNG/WebP work |                  417.42 s |
| Derive and encode 341 parent PNG/WebP pairs            |                   29.54 s |
| Complete local output                                  | **447.05 s (7 min 27 s)** |

These figures exclude engine startup/map loading and subsequent verification. Summed source
capture/artifact-validation/copy time is 416.66 s. Summed leaf crop/encode time is 52.90 s and
overlaps capture, so it must not be added again. WebP delivery totals 294.76 MB, compared with
4025.27 MB of PNGs encoded at lossless compression level one. This is one complex-map measurement;
without the prohibited fresh five-level baseline it does not establish a measured speedup over that
workflow or reproduce the reported hour-long run.

Verification decoded every PNG, checked all PNG/WebP dimensions and file hashes, validated complete
grid coverage through the public manifest schema, and proved that every pixel in all **1024 leaves**
equals an independent Sharp extraction from its source. Across every parent, 10,912 sampled pixels
match a separate floating-point sRGB reduction within one byte. A local tiled viewer passed all six
zoom levels, PNG/WebP selection, and 1:1 viewing without browser errors; its 25 image requests were
all individual tile files. Source map hashes and editor dirty-state checks remained unchanged.
Session restoration succeeded and the owned editor was stopped. The private experiment scripts
passed strict TypeScript checks. The source-block project run is specific to 5.8.2; it is not an
additional 5.7 adopter-project result. The preceding generic renderer checks cover both engine lines.

Image preservation by cropping is established; renderer quality equivalence is still unqualified.
The adopter configures `r.Shadow.Virtual.MaxPhysicalPages=1024`, and Unreal logged **13** shadow-page
pool overflow warnings during the run, explicitly warning about missing shadows. Comparison of all
112 adjacent source overlap strips found a mean absolute RGB difference of **10.63/255**, with the
worst edge averaging **29.20/255**. The strips cover the same world pixels; these differences include
lighting, view history and temporal noise, not just seam visibility. No perceptual pass/fail threshold
or matched repeat was established. A successful lossless crop cannot eliminate these rendering
differences. Capture-budget and complex-world quality qualification are required before enabling the
strategy by default; the existing settings were retained for this timing experiment.

## Three-level quality comparison: failed

A requested comparison used the same saved overview bounds and capture height, with a three-level
copy of the plan. One 4128-square source (4096 logical pixels plus gutters) was sliced into sixteen
1K leaves; the other approach captured sixteen 1056-square sources. Each approach derived five
parents. Both used one scoped editor-viewport render session, shared metered exposure and scene
freeze, and 128 outer settling frames per source. The second trial reversed capture order. The
engine was the adopter's matching **UE 5.8.2**; this complex-project comparison was not run on 5.7.
The existing five-level workflow was not run.

| Capture order | 4K source, slicing and derivation | Sixteen 1K sources and derivation |
| ------------- | --------------------------------: | --------------------------------: |
| 4K first      |                           7.955 s |                          61.838 s |
| 1K first      |                           7.853 s |                          62.525 s |

Shared metering, settling and one seed screenshot took 20.712 s, excluded from both columns. Engine
startup and verification are also excluded. All 64 leaf crops and 20 parent reductions passed pixel
verification across the four cases; all 84 PNG/WebP tile pairs passed dimensions, hashes and coverage.
Source map and saved-plan hashes stayed unchanged, and native restoration succeeded.

Visual review of the zoomable comparison rejected the 4K result: lighting, shadow readability and
detail differ substantially from the individual captures. Reversing order did not remove the
difference. The approximately eightfold timing ratio therefore describes a **failed quality
candidate**, not a usable equivalent replacement. The renderer logged 19 shadow-page pool overflow
warnings. Successful image processing and artifact checks are separate from quality acceptance.
Private identities and images remain under ignored `out/map-capture-comparison-2026-10-13/`.

Source inspection found a concrete difference beyond output resolution. In UE **5.7.4**, **5.8.3**
and the adopter's **5.8.2**, `Runtime/Renderer/Private/VirtualShadowMaps/VirtualShadowMapClipmap.cpp`
estimates the first orthographic directional-shadow clipmap level from half the camera's world
width when `r.Ortho.VSM.EstimateClipmapLevels` is enabled. It takes the floor of the base-two
logarithm. A roughly fourfold wider source can therefore omit two finer clipmap levels even when
its output has four times as many pixels per side. Clipmap origin also follows the camera/view
target. Epic documents these controls in its
[orthographic camera guide](https://dev.epicgames.com/documentation/en-us/unreal-engine/orthographic-camera-in-unreal-engine).

This is a source-derived mechanism to investigate, not a demonstrated sole cause of the observed
mismatch. Actual per-frame clipmap values and the contribution of pool overflow, Lumen, streaming
and temporal history were not isolated. Outer settling still uses the ordinary viewport rather
than the final 4K dummy viewport. No renderer setting was changed to claim a fix, and no quality
equivalence was established. Further experiments must pass image review before timing is used to
recommend adoption.

## Controlled follow-up: resolution, settling and delivery

The next investigation varied settings separately in an owned hidden editor on the same complex
map, inspecting original PNGs rather than treating crop checks or pixel-error scores as visual
acceptance. Four selected 1K regions provided mountain, buildings, foliage and road references;
repeated references measured rendering-history variation. The investigation captured 87 timed
sources plus nine shared seed captures across the batches. No five-level run was performed.

A private viewport probe measured the ordinary editor viewport at **492×157**. Native screenshot
size does not resize that viewport during the preceding settling phase. When the probe set the
viewport to 4128×4128, the editor's automatic screen-percentage heuristic selected a primary
resolution fraction of **0.393642**. This corresponds to roughly 1625 input pixels per axis before
upscaling, although the exact aligned render rectangle was not instrumented. Requesting a 4K PNG
therefore does not establish that either the outer warmup or its image formation used 4K input
pixels. The editor deliberately ignores `r.ScreenPercentage`; its viewport-specific settings apply.

The source-defined mechanism is in `Editor/UnrealEd/Private/EditorViewportClient.cpp` and
`Runtime/Engine/Private/LegacyScreenPercentageDriver.cpp`. A private probe compiled and exercised
viewport sizing/restoration on installed **UE 5.7.4** and **UE 5.8.3**, with normal editor exit on
both. Both selected the same 0.393642 fraction at 4128 square with the inspected settings. The
complex-map experiments use **UE 5.8.2**. Its probe was linked against the existing engine libraries
after the normal build guard rejected recompiling engine dependencies; no engine binary or map
asset was changed. The probe is local diagnostic code, not a shipped integration.

In the first controlled run, changing only `r.HighResScreenshotDelay` from four to 32 and 128
recovered roads, rocks and building structure. Returning to four frames reproduced the blurred
result. Native source/artifact capture took 6.543 s at 32 and 8.190 s at 128, compared with
6.321 s for the first four-frame source. These figures exclude common setup and subsequent leaf
crop processing. Later cases reached 14–16 s after larger render resources had been exercised;
the change in timing was not isolated, so the initial figures are not stable production guarantees.

Forcing 100% editor rendering also recovered detail. Warming the ordinary viewport at 4128 square
before the screenshot produced readable detail at the native four-frame default; its measured
source capture was 6.982 s, rising to 13.161 s with 100% rendering. Increasing the shadow pool to
8192 pages or changing orthographic shadow-level selection alone did not recover the original blur.
Those shadow settings may still affect lighting; these tests do not establish that they are irrelevant.
Manually replacing camera clip-plane behavior produced an unusable image and was rejected.

The reviewer's preferred overview was the **128 native-frame** result; the **32 native-frame** result
was also acceptable for this cartographic use case. Lighting and fine noise still differ from the
individual-camera reference. This revises the recommendation for that particular overview without
withdrawing the failure of the original default four-frame shortcut. A final trial retained 128
native frames while reducing outer settling to 16: two complete source/artifact captures took
5.467 s and 6.202 s. Inspection retained readable roads and buildings; this shorter outer policy
needs broader content and startup qualification before becoming a default.

An independent 1K settling sweep retained the native four-frame screenshot default and measured
eight selected-region captures per setting:

| Outer settling frames | Mean source/artifact capture |
| --------------------- | ---------------------------: |
| 128                   |                      3.985 s |
| 64                    |                      2.078 s |
| 32                    |                      1.096 s |
| 16                    |                      0.629 s |

Road/building structure was retained at 32, while 16 showed more noise. This is a useful alternate
performance lead that preserves individual camera footprints. It is not a pixel-equivalence claim:
reference repeats and cross-session comparisons have visible lighting-history variation.

Delivery tests used the preferred 128-frame source, lossless 1K crops, and five parents derived in
linear light through the public pixel helpers. Every zoom was derived before any lossy encoding.
The source's 4096 logical pixels become a 2048-square middle level and 1024-square root, delivered
as individual 1024-square tile files. WebP quality 90 throughout is the initial delivery baseline;
lower per-zoom quality is an optional additional bandwidth tradeoff rather than a substitute for
downsampling.

| Zoom | Tiles | Q90 mean tile | Q90 complete zoom | Optional lower quality | Mean tile at lower quality |
| ---- | ----: | ------------: | ----------------: | ---------------------: | -------------------------: |
| Root |     1 |       273 KiB |           273 KiB |                     50 |                     98 KiB |
| Mid  |     4 |       234 KiB |           938 KiB |                     70 |                     97 KiB |
| Leaf |    16 |       242 KiB |          3864 KiB |                     85 |                    178 KiB |

These are content-specific measured sizes, not codec size guarantees. All zooms at Q90 total about
4.96 MiB; the viewer only requests visible 1K tiles. Original PNG comparison, selectable zoom/quality,
mobile layout and an offline single-HTML artifact passed browser checks. The complex-map capture
sessions restored native ownership and console values, source map and plan hashes stayed unchanged,
and owned editors were stopped. Evidence remains under ignored `out/map-capture-diagnosis-2026-10-13/`.

The investigation controlled native run-up and viewport resolution through private diagnostic code.
Release preparation subsequently exposed optional `renderer.screenshotWarmupFrames` (1–256) on the
public viewport policy, with capability negotiation and per-frame restoration. Viewport sizing and
screen-percentage controls remain private probes. A production adopter separately qualifies and owns
the chosen rendering policy; source dimension/memory checks do not select it or certify quality.

## Implementation recommendation

The caller-managed primitives are exposed in `@ue-shed/cameras`; see the
[map tile source contract](../products/map-tile-sources.md). Source planning accepts individual
tiles or explicit blocks at a caller-selected zoom, validates dimension/decoded-memory budgets,
and returns exact cameras and crop rectangles. Lossless crop and linear-light parent reduction
are separate optional operations. Rendering policy, codecs, scheduling, retries and publication
remain host-owned, and the complete map-run backend keeps its existing defaults.

The source API's focused integration check rendered 4128×4128, 1056×1056 and 3104×2080 sources
and restored ownership on both **UE 5.7.4** and **UE 5.8.3**; matching plugin builds also passed.
A clean packed consumer proved all three public entry points, both source strategies, crops and
parent derivation. Replaying the new primitives over the retained six-level experiment reproduced
all 64 source cameras/sizes and every pixel of all 1024 crops and 341 parents without recapturing.
This verifies the reusable transformations and native contracts, not renderer quality equivalence.

Release qualification of the optional screenshot warmup setting built all eleven plugins and passed
35 automation checks on each of UE **5.7.4** and **5.8.3**. The native check covers 32/128-frame
captures, omitted/default behavior, invalid bounds, cancellation, pending lease expiry and external
console takeover, including per-frame value/priority restoration and clean map state. The public SDK
source integration also passed the three sizes above with 32 native frames on both engine lines.

1. Retain individually rendered tiles as the complex-map fidelity baseline. Expose explicit source
   strategies for callers that qualify a larger footprint on their own content. Compose the existing
   `CameraRenderer`; check advertised dimensions and a conservative memory budget before requesting
   a larger source. Passing those limits is not quality acceptance.
2. Capture finest-detail pixels once and derive lower levels. Preserve the existing independent
   path for per-level LOD policies or callers who intentionally want different renders per zoom.
   Record derivation/source hashes truthfully; do not attach a copied leaf camera's evidence to a
   parent as though Unreal rendered that parent.
3. Separate logical-tile progress from source-frame progress. Keep bounded memory, scoped exposure,
   freeze, preparation, cancellation and restoration, artifact containment/hashes, and atomic
   publication. A block-sized retry must preserve those ownership/publication rules.
4. Qualify reduced or adaptive outer warmup on representative complex worlds. Instrument residency,
   viewport warmup, native screenshot/readback, encode and ingest separately. Retain an explicit
   conservative mode until images, order sensitivity and loading behavior justify a shorter wait.
5. Profile redundant native PNG work without changing camera image formation: the shared renderer
   decodes to validate; the Lit adapter decodes again, crops and encodes again. Bounded background
   encode/write is a possible secondary improvement, with its contribution measured separately.

A 16,384-square BGRA8 image alone occupies 1 GiB; scene color, depth, G-buffers, post processing,
readback and decoded CPU copies add substantially more. A nominal 16K texture limit is not a safe
VRAM budget. Outer gutters can also push an otherwise 16K source above that limit. A whole master
does not need internal tile gutters; blocks need overlap only at their external boundaries.

Movie Render Queue is a separate qualification project. Epic's
[image-quality settings](https://dev.epicgames.com/documentation/en-us/unreal-engine/cinematic-rendering-image-quality-settings-in-unreal-engine)
document restrictions on temporal AA and screen-space features in its High Resolution tiling.
It should not be assumed to preserve viewport quality automatically. The source/pyramid strategy
above provides a smaller experiment through an already shipped renderer.
