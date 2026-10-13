# Game Text performance experiments — consolidated 2026-10-13

[ADR 0010](../decisions/0010-game-text-performance-policy.md) adopts the retained implementation
at `5332c6e1` in performance PR #67, stacked on UX PR #66. The accepted target-only generated 1× cache is
**81.8 MiB**. This record consolidates the initial two-hour investigation, both one-hour
continuations and the same-workload Workbench investigation. It records historical measurements;
[Game Text snapshots](../engineering/game-text-snapshots.md)
owns the maintained implementation contract.

## Results and measurement boundaries

Windows, Node 26.5.0; initial native builds use Rust 1.93.0-nightly, release thin LTO and one codegen
unit. Runs alternate revisions in fresh processes with warm OS caches. Cold means a fresh derived
cache. The generated 1× workload has 16,500 package records, 21 localization files, ten cultures,
583,507 lines and 1,028,205 saved occurrences. Its retained-record runs exclude native discovery and
extraction. The separate 12k native workload copies three committed fixture packages and produces
88,000 occurrences. No studio-project or 10× measurement was used.

Latest cache phase: three alternating processes per revision and mode, baseline `87489f75` versus
accepted `5332c6e1`. An independent parent samples Node RSS every 10 ms. Reopening uses an existing
cache in another fresh process. The table contains medians, not an already-open query-only timer.

| Latest retained 1× measurement                 |      Before |       After |
| ---------------------------------------------- | ----------: | ----------: |
| Settled derived cache                          |    79.1 MiB |    81.8 MiB |
| Cold refresh to query readiness                |     72.55 s |     69.14 s |
| Serial join                                    |     23.78 s |     21.80 s |
| Unchanged refresh/reopen to readiness          |     3.347 s |     2.450 s |
| First empty page after reopening               |    11.66 ms |    11.07 ms |
| First absent `text` search after reopening     |    39.55 ms |    24.26 ms |
| First absent `Continue` search after reopening |    26.50 ms |    22.50 ms |
| First matching `velora` search                 |    67.67 ms |    66.94 ms |
| First sparse `45678` search, 16 matches        |    50.78 ms |    55.64 ms |
| Cold peak Node RSS                             | 2,463.2 MiB | 2,372.2 MiB |
| Reopening peak Node RSS                        |   879.0 MiB |   836.5 MiB |

The extra 2.7 MiB improves reopening **26.8%** and cold readiness **4.7%**. Matching searches have
no general improvement; the sparse first search is about 5 ms slower. Cold RSS ranges overlap:
2,406.5–2,494.7 MiB before, 2,349.6–2,569.8 MiB after. This is not a hard memory bound.

The 150 MiB allowance covers this fixture's settled derived Game Text cache. Native Catalog,
retained inputs, staging, other experiment copies and arbitrary extra targets/pinned generations
are outside that figure. The unused allowance is not a reason to add a second representation.

Earlier phases use their own alternating comparisons and must not be combined into a single
same-session speed claim:

| Earlier measured path                                   |                Before |                 After |
| ------------------------------------------------------- | --------------------: | --------------------: |
| 12k release extraction, three pairs                     |    1.414 s / 72.3 MiB |    0.667 s / 16.2 MiB |
| 12k complete public API to first results, three pairs   |              17.888 s |              13.094 s |
| That pipeline's peak Node RSS                           |             307.3 MiB |             306.0 MiB |
| Retained 1× first bounded page, three processes         |               60.3 ms |               11.6 ms |
| Retained 1× warm refresh, three processes               |               3.556 s |               3.331 s |
| Cold preparation continuation, three pairs              | 83.63 s / 2,610.5 MiB | 71.25 s / 2,416.1 MiB |
| Its localization preparation/publication                |               25.00 s |               16.47 s |
| Its localization dictionary sort                        |               13.25 s |                5.88 s |
| Its localization publication, including sort/conversion |               16.88 s |                7.96 s |
| Its package preparation/publication                     |               31.72 s |               27.93 s |
| Its final join                                          |               24.01 s |               23.61 s |

Initial baseline was `8a45ffaf`; the cold continuation compared `a5b2c8c0` with `87489f75`.
The initial retained-record cold observation was 88.08 → 85.76 seconds, one run per revision,
not a repeated speed claim. Public readiness includes other boundary work and opening; stage
medians do not sum exactly. Worker encode/verify counters sum concurrent work, not wall time.
Those backend timers exclude Electron launch, painting and typing debounce. Sampled RSS can miss brief allocations;
post-GC array-buffer checkpoints are a different measure.

## Historical same-workload comparison: backend versus Workbench

The follow-up uses the **exact retained 1× project, package records and localization files** from
above. It supersedes the smaller screenshot-fixture comparison for this question. Three fresh
backend caches and three fresh Workbench profiles supply cold runs; existing caches are reopened
in fresh processes. The query is empty, all ten cultures are selected, and the first problem group
shows 50 rows. Native discovery/extraction and application startup are excluded on both paths,
as in the original retained-record experiment. OS caches are warm.

| Same-input path and endpoint                               | Samples |    Median |             Range |
| ---------------------------------------------------------- | ------: | --------: | ----------------: |
| Backend target-first refresh plus first bounded page, cold |       3 |  74.387 s |   69.879–88.194 s |
| Workbench **Scan project** click to usable results, cold   |       3 | 185.182 s | 184.174–222.037 s |
| Backend refresh/reopen plus first bounded page, cached     |       3 |   2.501 s |     2.468–2.761 s |
| Workbench **Rescan** immediately after its cold scan       |       3 |  12.327 s |   11.173–12.952 s |
| Workbench **Scan project**, existing cache, fresh process  |       3 |   6.436 s |     6.178–6.492 s |
| Subsequent Workbench **Rescan**, existing cache, open app  |       9 |  13.316 s |    9.812–17.700 s |

These observations precede the host repair below; they are not a before/after optimization claim. The historical
69.14/2.45-second medians remain valid backend-only results from the earlier three-pair comparison.
The current cold backend range is wide; its current median is 74.39 seconds including the first
page. The 1.26-second small-fixture rescan cannot stand in for this larger workload.

Workbench used source-first preparation, built a separate localization join and opened a query
worker for each model. Both object wrappers were already lazy: the earlier explanation that
refresh materialized both complete object models was incorrect. Visible groups load through
worker-backed queries and IPC. The backend benchmark prepares only the selected target and uses bounded direct
queries. Workbench runs Electron 43.7.7 / Node 24.21.0 with its production renderer; the backend
runs Node 26.5.0. These differences are part of the measured desktop path. The timings do not
isolate a runtime-version effect or attribute every additional second to rendering.

Cached rescans reread **zero packages** and reparse **zero localization files**. In the nine repeated
rescans, the source-refresh IPC has a 9.123-second median and target preparation a 2.742-second
median. The later investigation reproduced the delay in plain Electron without a main-process
debugger: rescans retired two large query workers, each taking roughly 3–4 seconds to terminate,
with the main process largely waiting. Preparing two joins also inflated cold work. Accessing the
lazy corpus/join wrappers did not itself materialize every line. The source and target IPC medians
describe separate work; their medians need not add to the end-to-end median.

Timing starts at the actual renderer click. The endpoint requires enabled Rescan, no scan activity,
loaded visible rows, no open-group loading, completed observed blocking requests, and two animation
frames. Workbench's rounded **ready in** ends before the final group is loaded: the median gap is
0.898 seconds for repeated rescans, rather than the roughly one-frame gap on the small fixture.
Search and line focus work afterward; German translation-editor focus succeeds in all three profiles.
Future pages and other views retain their normal on-demand loading.

The isolated benchmark build replaces only the native input providers: `GameTextIndexSource` reads
the exact retained records, and `ProjectIndexMemory` supplies their retained shell inventory. The
production refresh, target preparation, IPC results, query worker and renderer are used without
mocking replies. The first build exposed a real missing `cold-layer-worker.js` entry in Workbench's
bundle; that entry is now emitted and exercised by all three successful large cold scans. The
adoption guide documents all required worker entries.

A post-timing selector encoding error in the first round was fixed before later interaction checks.
One repeated-scan probe lost its Electron inspection context after visible readiness; that incomplete
observation is excluded and replaced after relaunch, using the renderer's mirrored pending-request
counter. Startup/shutdown are outside the click boundary. All 18 retained UI observations have no
page errors or renderer long tasks; the largest observed animation-frame gap is 33.6 ms.

Backend pages have the original raw SHA-256
`097f17aa317f8de46a927e1651407d2e0e1bf3f89f8575ba6133ae812fee730a`. IPC serialization changes object
property order, so full JSON values are compared recursively. Empty, absent, matching and sparse
query pages match exactly, including line order and culture marks. The Workbench source-plus-target
cache settles at **140.8 MiB**, versus **81.8 MiB** for the backend target-only cache. Both exclude
retained inputs, native Catalog and experimental copies, and fit the experimental 150 MiB allowance.

Raw precision, stage/IPC timings, comparisons and per-profile cache bytes are in
`phases.workbenchRetainedUi` of the consolidated JSON. The probes and original evidence are preserved
in `out/game-text-experiments-2026-10-13/same-workload-evidence.zip`; build, search, line-focus and
translation-editor checks are successful. This follow-up does not change the indexing algorithm.

## Host repair on the latest UX baseline

The repeated before/after comparison uses baseline `99c57825`, which merges the latest committed
PR #66 review (`c1c948d7`) into the performance branch. Both variants use the same production
Solid 2 renderer, so these timings isolate the host pipeline change. Plain Electron launches with
renderer CDP only; no main-process inspector is attached. The input paths, retained adapters,
empty query, ten cultures, first 50-row problem group and click-to-usable endpoint match the large
workload above. Native discovery/extraction and application startup remain excluded.

Three fresh profiles per revision and mode run in sequential blocks with warm OS caches. Each
profile supplies three ordinary rescans. Cached profiles start with an identical copy of the
baseline derived cache. These are a separate repeated comparison, not a splice into the earlier
alternating backend runs.

| Actual Workbench click to usable results | Samples per variant |       Before median (range) |        After median (range) |
| ---------------------------------------- | ------------------: | --------------------------: | --------------------------: |
| Cold scan                                |                   3 | 178.962 s (168.539–184.217) | 126.842 s (124.261–129.963) |
| Rescan after cold scan                   |                   9 |    13.114 s (11.448–15.532) |       2.563 s (2.464–2.729) |
| Cached scan in a fresh process           |                   3 |       6.257 s (6.203–6.281) |       4.809 s (4.771–4.812) |
| Subsequent Rescan in that process        |                   9 |     11.912 s (9.381–15.113) |       2.463 s (2.414–2.514) |

Workbench now prepares one primary target index, whose raw projection also serves source browsing.
Localization validates current inputs before reusing that model. Scoped worker ownership shares
one worker across overlapping readers of the same immutable join and releases it when the last
pin closes. Changed generations receive fresh workers. Source-only fallback remains available
when target preparation fails. The selected target survives inventory-generation changes within
the shell's selected project; the route still cannot select a project.

Solid 2 functional keys preserve group and row DOM identity when reloads supply new objects with
the same IDs. Paginated reloads publish the restored page count atomically, retaining the previous
rows while later pages load or fail. Component tests cover 100 loaded rows, focus and updated row
handlers. These renderer changes are present in both timing variants and have their own correctness
evidence; this comparison does not assign them a separate speedup.

Fresh Workbench derived caches settle at **81.776 MiB**, down from **140.824 MiB**. Reopening a copied
old cache leaves it at **140.824 MiB**: this change does not automatically prune its existing source
layers. These figures exclude native Catalog, retained inputs, staging and experimental copies.
All 132 full JSON query pages across twelve profiles equal the original backend values, including
positive, sparse, uppercase and Unicode-whitespace queries. No page errors or renderer long tasks
were observed; the final cold/cached runs' largest sampled frame gaps are 33.7/33.5 ms.

Six separate German-editor checks retain the typed draft through an actual Rescan. Their sparse
16-row query has rescan medians of 2.201 seconds after cold scans and 2.200 seconds after cached
scans, three samples each. This different visible workload is excluded from the default-list table.
No translation files are written by those checks.

One headless control per runtime uses the same input adapter, tsx loader and fresh C: cache volume:
Node 26.5.0 reaches the first page in **70.455 seconds**, while Electron's embedded Node 24.21.0 takes
**122.602 seconds**, with identical result hashes. No window or renderer exists in this control.
This is diagnostic evidence, not a repeated speed claim or an isolated Node-version comparison:
runtime, worker bootstrap and execution behavior remain to be separated. The remaining cold gap
cannot be attributed to Solid rendering. An earlier control on D: failed with `ENOSPC` and supplies
no timing result.

Raw click/IPC samples, cache bytes and the runtime control are under `phases.workbenchHostRepair`
in the consolidated JSON. The complete probes, logs, page values, screenshots and profiles are
archived locally in `out/game-text-experiments-2026-10-13/host-repair-evidence.zip`.

## Small screenshot fixture: supplementary UI check

The later UI check measures real Electron clicks on the screenshot fixture: 5,212 discovered
packages, 5,165 inspected assets, 47 exclusions and 64 localization lines. Workbench is rebuilt
from `1f930905`, with its production renderer, Electron 43.5.0 and the default Showcase debug
native reader. Native discovery/extraction is included. The first scan uses a cold text cache in
a fresh isolated profile; the shell may already have prepared its Catalog. OS caches are warm.
This is a different workload from the retained 583,507-line backend benchmark above.

| Current Text view, click to usable results                                     | Samples |  Median |          Range |
| ------------------------------------------------------------------------------ | ------: | ------: | -------------: |
| First **Scan project**, cold text cache                                        |       3 | 9.879 s | 9.843–10.213 s |
| Unchanged **Rescan**, default list                                             |       9 | 1.264 s |  1.211–1.313 s |
| Unchanged **Rescan**, translated line open, German selected, two folder groups |       9 | 1.296 s |  1.197–1.547 s |
| **Scan project** after restarting Electron with its existing cache             |       3 | 1.347 s |  1.330–1.480 s |

Timing starts in the renderer's capture-phase click listener. Readiness requires Rescan enabled,
scan activity gone, rows present, open-group loading gone and the observed blocking Game Text
requests complete, followed by two animation-frame observations. The translated-line case also
checks its German translation after each rescan. Search, line selection and translation-editor
focus work afterward. Closed groups, future pages and other tabs remain loaded on demand.

Temporary observation wrappers return the original IPC results; no corpus reply is mocked and no
runtime source is changed. Three fresh profiles each supply three repeated rescans; translated
focus checks reuse those profiles in fresh Electron processes. The first source-refresh reply in
the default rescan has a 699 ms median, while target preparation has a 390 ms median. Target
discovery, query delay, grouped requests and rendering complete the 1.264-second result.

Workbench's displayed **ready in** already includes translation preparation and the first query.
It rounds down to whole seconds and stops before the final open-group/frame readiness milestone:
about 14 ms earlier in the default rescan and 15 ms earlier in the translated-line case. The older
69.14/2.45-second figures remain backend-only measurements; this fixture check cannot convert the
larger retained-record workload into an end-to-end UI result.

Build and interaction checks pass, with no page errors or renderer long tasks; the largest sampled
animation-frame gap is 17.4 ms. These observations cover this fixture and current Text view, not
every future interaction or a hardware display-latency guarantee. Raw samples and IPC timings
are under `phases.workbenchUi` in the consolidated JSON; local probes/logs/screenshots are under
`out/game-text-experiments-2026-10-13/workbench-rescan*`.

## Retained experiments

Isolated rows are exploratory single comparisons unless their sampling is stated. The combined
headline results above provide the repeated whole-path evidence.

| Change and workload                                                                | Before → after                                     | Reason to keep                                   |
| ---------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------ |
| Bounded ordered Rust delivery, 12k packages                                        | 1.407 → 1.274 s; 72.4 → 15.5 MiB                   | Bound in-flight work and reorder buffers.        |
| Avoid redundant path file-type stat                                                | 1.274 → 1.040 s                                    | Preserve containment and extension checks.       |
| Bounded concurrent explicit-path validation                                        | 1.040 → 0.673 s                                    | Preserve failure/input order.                    |
| Final release Rust changes, three pairs                                            | 1.414 → 0.667 s; first result 1.235 → 0.427 s      | Identical package/occurrence hashes.             |
| Signature checks, 12k bundles / 96k stats                                          | 6.014 → 2.193 s                                    | Retain both before/after verification.           |
| Bounded default-page warming, retained 1×                                          | 60.3 → 11.6 ms; 1,064.7 → 869.9 MiB                | Keep unused fields lazy.                         |
| Trim spare prepared-source capacity                                                | 128 → 72.5 MiB backing                             | Preserve encoded source bytes.                   |
| Safe lowercase-ASCII rejection for absent `é`                                      | 160.75 → 13.38 ms                                  | Retain Unicode folding and cancellation.         |
| Numeric raw-focus reverse index, 60 requests                                       | 125.88 → 7.33 ms                                   | About 2.2 MiB; same selected line.               |
| Quality grouping, seven final pairs, 16k / 32k shared occurrences                  | 681.32 / 2,688.12 → 3.88 / 5.12 ms                 | Remove quadratic occurrence copying.             |
| Prepared terminology and safe literal rejection, seven final pairs, 50k × 20 terms | 663.46 → 71.23 ms                                  | Preserve regex/Unicode fallback.                 |
| Start largest cold file with eligible peers                                        | Localization preparation 8.37 → 6.50 s             | Replace blocking memory probe with reservations. |
| Prepare string runs/hashes in parser workers                                       | Sort 13.37 → 6.04 s; localization 25.38 → 18.12 s  | Avoid coordinator re-decoding.                   |
| Convert larger staged layers in workers                                            | Publication 9.54 → 8.00 s                          | Coordinator retains lease/root publication.      |
| Wire larger cold package batches to workers                                        | Package 32.48 → 27.62 s; sort 6.62 → 3.92 s        | Existing helper becomes active.                  |
| Two-entry comparator cache and smaller run buffers                                 | Wired join 24.70 → final median 23.61 s            | Bound scratch memory; combined comparison.       |
| Numeric review lookup / precomputed state codes                                    | Mark pass 866.6 → 120.9 ms                         | Avoid identity strings per line/culture.         |
| Bounded locale runs, three alternating micro pairs per kind                        | Raw/line sort 1,466.7 / 1,442.3 → 563.4 / 616.5 ms | Stable exact order; bounded decoded runs.        |
| Verified source bytes, ASCII flags and trigrams                                    | Reopen 3.347 → 2.450 s; cache +2.7 MiB             | Combined repeated result; immutable cache.       |

Cold parser reservations use half the available memory, up to eight workers and 128 MiB plus
32 times file bytes per task. Oversized tasks run alone. Conversion uses weighted reservations
and copied maps; small package sets and mappings keep the coordinator path. Locale sorting bounds
runs by 8,192 entries and 4 MiB encoded bytes. Optional source caching needs at least 8,192 sources,
caps raw data at 96 MiB and conservatively bounds stored sections at 16 MiB. The canonical format
document describes overlay/compaction behavior and fallback.

## Rejected experiments

| Trial and workload                            | Before → after                                           | Reason to reject                               |
| --------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------- |
| Native workers 4 → 8 / 16                     | 1.407 → 1.327 / 1.317 s; 72.4 → 75.4 / 77.6 MiB          | Small gain; keep default 4.                    |
| Native requests split to 1,024 / 256 packages | 1.407 → 1.624 / 2.270 s; 72.4 → 13.0 / 7.6 MiB           | Repeated startup loses throughput.             |
| Blanket removal of query prefetch             | Preparation 2.444 → 1.829 s; first query 37.5 → 186.8 ms | Bad first interaction.                         |
| Decoded cache 32 → 8 MiB                      | First page 11.55 → 33.70 ms; RSS 995.9 → 982.2 MiB       | Small memory saving, worse latency.            |
| Cache all source visibility/length/word facts | Join 24.70 → 23.10 s; full 71.91 → 70.98 s; RSS +96 MiB  | Extra RAM for a small whole-path gain.         |
| Flat dictionary mirrors                       | Bulk 1.243 → 0.419 s; full 71.05 s / 102.3 MiB           | Mirror creation offsets read savings.          |
| All dictionary compression at level 1         | Retained 69.14 s / 81.8 MiB → trial 69.96 s / 82.1 MiB   | No overall benefit.                            |
| Joined compression −1                         | Write/verify 549/326 → 606/338 ms; 57.0 → 56.8 MiB       | Slower publication.                            |
| Joined compression −3                         | Write/verify 549/326 → 605/255 ms; 57.0 → 93.1 MiB       | Too many bytes for a small read saving.        |
| Joined compression −5                         | Write/verify 549/326 → 610/258 ms; 57.0 → 102.4 MiB      | Same tradeoff, more storage.                   |
| Poorly compressing numeric joined columns raw | Write/verify 549/326 → 491/272 ms; 57.0 → 74.9 MiB       | Small isolated saving, no useful pipeline win. |
| Entire joined snapshot raw                    | Write/verify 549/326 → 1,083/194 ms; 57.0 → 434.3 MiB    | Exceeds allowance and slows publication.       |

Compression trials rewrite the same pre-encoded columns, not a complete refresh. All original
raw cache sections total roughly 695 MiB. The separate unfinished native builder was inspected
but not adopted; its implementation is changing independently. No historical prototype timing is
advertised as a fresh native-builder comparison.

## Correctness and verification

Five-page cold/reopen hash: `097f17aa317f8de46a927e1651407d2e0e1bf3f89f8575ba6133ae812fee730a`.
Positive/sparse/multiterm/uppercase/Unicode-whitespace query hash:
`7e06ad0a562c94c3ac08eab33f2dbfd3f1c94ab418788bc4548c82c87124ffd8`.
All paired results match. Native, focus, quality, sorting and bulk hashes remain in the JSON record.

Host-repair verification: `pnpm run check:repository --maxWorkers=4` passes **2,453 tests**,
95 expected skips and 328 test files; precommit and Effect architecture pass. A final focused rerun
passes 51 tests across seven files, including selected-target recovery, worker lifetime and Solid 2
row/pagination checks; Workbench typecheck and the production builds pass. The preceding retained
runtime gate passed 2,430 tests with 94 expected skips and 326 files. Its separate **1,000-seed**
differential suite passed nine tests, and targeted cache/codec tests passed 12 tests. An initial default
repository attempt had 13 timeouts and no assertion failures; its affected suites pass 71 tests
with four workers, followed by the complete bounded-worker pass without increased timeouts.

Saved **UE 5.7** and **UE 5.8** pipeline comparisons each read 5,165 records, return 61 lines and
match `540f811ac5a1172e4b31a32e4fbcab748a59dbd8a20d26300b4cd5d6cd6961df`. Initial native changes
passed Clippy and 108 tests with one intentional ignore; both engines' saved extraction matched
22 occurrences in four packages. These are saved-byte checks, not fresh live editor/codegen/WASM
matrix runs. Later continuations do not change the native parser. Their final verification and PR
recording continued after each one-hour trial window.

## Compact artifacts and replay

[The consolidated JSON](game-text-pipeline-performance-2026-10-13.json) preserves raw timing/RSS
samples at their original precision, output hashes, exploratory comparisons and per-phase
verification. Recomputable summary fields, duplicate profiles and non-timing dictionary counters
are removed from the original phases. Query milliseconds share each run's query/match arrays.
The host-repair phase retains compact click/IPC samples; its full observations are in the archive.

The original full reports, traces, logs, probes and candidate modules are archived locally in
`out/game-text-experiments-2026-10-13/evidence.zip`, with checksums in `manifest.json`. One accepted
cache remains in that directory's `cache`. Dependency junctions were detached without changing
their targets. Automatic approval review blocked recursive deletion of the three original local
experiment directories, including a retry with a verified literal path, with only the reason
`blocked by policy`. Their duplicate caches, copied fixtures and build outputs therefore remain;
the consolidation has not reclaimed that disk space. The three original JSON files remain
available in git at `5332c6e1`. Generic generated inputs under `test-results/game-text-scale` are
retained separately.

The same-workload follow-ups have separate `same-workload-evidence.zip` and
`host-repair-evidence.zip` archives. The latter's file hashes and archive checksum are in
`host-repair-manifest.json`; copied applications, dependency trees and profile caches are excluded.
Automatic approval review also rejected removal of the host-repair duplicate caches with only
`blocked by policy`. Those copies remain; archiving the probes has not reclaimed their disk space.

The maintained public harness is `scripts/benchmark-game-text-pipeline.ts`. Build each revision
and provide its explicit module/native artifacts. For retained-record cold replay, pass `--records`
and omit `--cache`; a supplied cache measures reuse. Its memory fields are post-GC checkpoints,
not the independent sampled peaks above.

```powershell
node --import tsx scripts/benchmark-game-text-pipeline.ts `
  --project <read-only-project> --target <target> --records <retained-record-directory> `
  --before-module <baseline-dist/index.js> --reader <after-uasset> `
  --before-reader <before-uasset> --output test-results/game-text-paired.json --runs 3
```

Remaining opportunities include explaining the headless Electron runtime gap, mechanical
Rust-backed construction, fewer serial passes and column-driven quality evaluation. They require
new benchmarks and parity evidence. Performance
work does not fix the [saved-scan gaps compared with Unreal gather](../engineering/game-text-gather-coverage.md).
