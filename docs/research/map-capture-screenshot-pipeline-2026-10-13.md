# Revisiting the map screenshot pipeline — 2026-10-13

## Finding

The default Lit map backend already calls Unreal's `FViewport::TakeHighResScreenShot` for every
tile. Its remaining cost and fidelity differences come from the surrounding workflow: repeated
camera moves, a fixed 128-frame warmup per tile, separately rendered zoom levels, explicit exposure
and post-process choices, and repeated PNG processing. Replacing SceneCapture with a custom renderer
is not required to investigate a faster default.

The strongest next implementation is a bounded master/block capture through the existing public
`CameraRenderer`, followed by CPU slicing and a pyramid derived from the finest captured pixels.
Retain independently rendered tiles/levels when callers need their rendering policy or the source
cannot fit a declared texture and memory budget. Do not lower the default warmup merely because a
simple scene tolerates fewer frames.

This investigation adds a repeatable headless benchmark and a local source-block experiment. It does
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

## Implementation recommendation

The caller-managed primitives now ship in `@ue-shed/cameras`; see the
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

1. Use an explicit source strategy in the headless library: bounded master where affordable,
   otherwise bounded blocks. Compose the existing `CameraRenderer`; no engine fork or replacement
   SceneCapture renderer is needed. Check advertised dimensions and a conservative memory budget
   before requesting the source.
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
5. Remove redundant native PNG work after profiling it: the shared renderer decodes to validate;
   the Lit adapter decodes again, crops and encodes again. Bounded background encode/write is a
   secondary improvement once repeated rendering has been removed.

A 16,384-square BGRA8 image alone occupies 1 GiB; scene color, depth, G-buffers, post processing,
readback and decoded CPU copies add substantially more. A nominal 16K texture limit is not a safe
VRAM budget. Outer gutters can also push an otherwise 16K source above that limit. A whole master
does not need internal tile gutters; blocks need overlap only at their external boundaries.

Movie Render Queue is a separate qualification project. Epic's
[image-quality settings](https://dev.epicgames.com/documentation/en-us/unreal-engine/cinematic-rendering-image-quality-settings-in-unreal-engine)
document restrictions on temporal AA and screen-space features in its High Resolution tiling.
It should not be assumed to preserve viewport quality automatically. The source/pyramid strategy
above provides a smaller experiment through an already shipped renderer.
