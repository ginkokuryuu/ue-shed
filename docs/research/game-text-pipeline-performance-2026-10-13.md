# Game Text pipeline performance investigation

Measured during a two-hour investigation beginning **2026-10-12 15:45:23 UTC** (the session
crossed into October 13 in Bangkok). Baseline: `8a45ffaf`, including the Game Text UX changes.
The [aggregate evidence](game-text-pipeline-performance-2026-10-13.json) retains samples, ranges,
counts and output hashes. Temporary harnesses, logs and native binaries are under ignored
`out/game-text-perf-20261012/`.

## Method and boundaries

Windows, Node 26.5.0, Rust 1.93.0-nightly; release native builds use the repository's thin LTO
and one codegen unit. Timed runs were sequential, with alternating before/after order. OS caches
were warm; a cold application run means a fresh derived cache, not cold disk. Measurements use
generic committed fixtures or retained generated 1× inputs. No studio project or 10× run was used.

- Native extraction: 12,000 physical copies of three committed text packages, 88,000 occurrences,
  approximately 37 MB of output. A 5 ms sampler observes Windows peak working set. Three paired
  release runs compare the baseline and final binaries; package-event hashes must match.
- Complete native/TypeScript pipeline: the same packages through the public refresh service,
  Project Index, extraction, signature checks, snapshot builder and first query. Three fresh
  processes per variant; the first bounded page contains all 22 logical units. A 10 ms independent
  sampler observes Node (including its threads), native children and aggregate RSS.
- Retained 1×: 583,507 lines, 1,028,205 saved occurrences and ten cultures. Warm refresh uses the
  existing production index and retained signature inventory; native enumeration/extraction is
  excluded. Three processes per variant; 50-line page hashes match.
- Quality evaluation: seven alternating comparisons per shape, with input creation, GC and report
  hashing outside the timed function. These measure evaluation, not index hydration or UI display.

The public-pipeline timer ends at the returned first page. Electron launch, painting and typing
debounce are excluded. Checkpoint array-buffer sizes are not sampled peak RSS. The native and
pipeline RSS numbers use the independent samplers; short-lived allocations can still escape a
sampling interval. These are local measurements, not performance guarantees.

## Experiments and decisions

Times below are medians unless explicitly labelled as a single observation. Each row names its
workload; timings from different rows must not be added together.

| Tried                                                                                       |                                                                           Before |                                   After | Decision                                                                                                                                                     |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------: | --------------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bounded, ordered Rust delivery, 12k packages                                                |                                                    1.407 s; 72.4 MiB native peak |                       1.274 s; 15.5 MiB | **Keep.** At most two jobs per worker remain in flight. A slow package cannot grow the reorder buffer indefinitely.                                          |
| Avoid an unnecessary file-type stat during validated package-path selection                 |                                                                          1.274 s |                                 1.040 s | **Keep.** Canonical containment and invalid-extension checks remain.                                                                                         |
| Resolve large explicit path lists concurrently within the requested worker limit            |                                                                          1.040 s |                                 0.673 s | **Keep.** Small selections stay serial; failures retain input order.                                                                                         |
| Final Rust changes together, paired final release binaries                                  |                                          1.414 s; first result 1.235 s; 72.3 MiB | 0.667 s; first result 0.427 s; 16.2 MiB | **Keep.** Identical 12k package/88k occurrence hashes; measured package progress is emitted during inspection.                                               |
| Verify package/sidecar signatures with 16 bounded fibers, 12k bundles and 96k stats         |                                                                          6.014 s |                                 2.193 s | **Keep.** Both the pre-read and post-read checks remain; changed sidecars abort the read.                                                                    |
| Remove all query prefetching, older retained 1× projection                                  |                               Initial preparation 2.444 s; 999 MiB array buffers |                        1.829 s; 615 MiB | **Reject the blanket version.** In the fresh host comparison, first-query latency rose from 37.5 to 186.8 ms.                                                |
| Replace full-column prefetch with bounded default-page warming, same retained 1× cache      |                                    First page 60.3 ms; peak Node RSS 1,064.7 MiB |                      11.6 ms; 869.9 MiB | **Keep.** Unused occurrence, culture and rule fields remain lazy behind pinned readers.                                                                      |
| Trim excessive backing capacity in the prepared source arena                                |                                                           128 MiB source backing |                                72.5 MiB | **Keep.** A single copy is used only when spare capacity exceeds 25%; original encoded text remains unchanged.                                               |
| Reject known lowercase ASCII sources for a non-ASCII query, 1× absent `é` search            |                                                                        160.75 ms |                                13.38 ms | **Keep.** Other sources retain locale-sensitive folding and WTF-8 behavior, with cancellation checkpoints.                                                   |
| Replace repeated occurrence-array copying in quality grouping, 16k / 32k shared occurrences |                                                             637.73 / 2,556.77 ms |                          3.40 / 4.40 ms | **Keep.** Local accumulation preserves sorted output and never mutates corpus inputs.                                                                        |
| Prepare terminology ordering/regexes once per rule, 50k units × 20 absent terms             |                                                             Approximately 650 ms |                    Approximately 201 ms | **Keep, then refine.** This intermediate comparison is recorded in `quality-results.log`.                                                                    |
| Add safe literal rejection before regex matching on the same terminology workload           |                                                               648.88 ms original |                       64.52 ms combined | **Keep.** ASCII-only insensitive rejection and sensitive literal rejection are safe; positive matches and Unicode folding still use RegExp.                  |
| Cache the raw-unit → localization-line reverse index, 60 distributed focus requests         |                                                                        125.88 ms |                                 7.33 ms | **Keep.** Uses a roughly 2.2 MiB numeric array and preserves the prior last-matching-line behavior. Some full-detail hydration requests still exceed 100 ms. |
| Increase native extraction workers from 4 to 8 / 16                                         |                                                                1.407 s; 72.4 MiB |        1.327 / 1.317 s; 75.4 / 77.6 MiB | **Leave the default at 4.** Modest local benefit, more memory; callers can already configure concurrency.                                                    |
| Split native extraction into 1,024 / 256-package subprocess requests                        |                                                                1.407 s; 72.4 MiB |         1.624 / 2.270 s; 13.0 / 7.6 MiB | **Reject.** Memory improves, but repeated startup/discovery loses throughput. Native streaming achieves the desired bound inside one process.                |
| Reduce shared-string frame/decoded cache budgets from 32 to 8 MiB                           | First page 11.55 ms; warm ready 3.322 s; peak Node RSS 995.9 MiB including focus |            33.70 ms; 3.398 s; 982.2 MiB | **Reject as the default.** Only about 14 MiB lower measured peak, worse first-page latency, and no useful focus improvement.                                 |

The UTF-8/ASCII spelling of a term is not a general substitute for Unicode regex folding. The
quality fast path deliberately falls back for non-ASCII case-insensitive input. Tests include
Kelvin sign, long s, dotted/dotless I, Greek sigma, literal regex punctuation and frozen inputs.
The search oracle also covers combining-dot queries, supplementary characters and lone surrogates.

## Whole pipeline results

| Same-input operation                   |  Baseline | Native changes only | TypeScript changes only |  Combined |
| -------------------------------------- | --------: | ------------------: | ----------------------: | --------: |
| 12k-package cold public API to results |  17.888 s |            17.390 s |                13.641 s |  13.094 s |
| Node peak RSS for that run             | 307.3 MiB |           315.9 MiB |               306.9 MiB | 306.0 MiB |

The combined result is **26.8% faster**. Native-only savings are much smaller here than in the
extraction microbenchmark: serial signature verification and TypeScript parsing/indexing dominate
the complete path. Cold pipeline peak memory does not materially improve in this small-text shape.

The retained 1× warm pipeline falls from **3.556 to 3.331 s** in the three-run comparison, with peak
Node RSS falling **18.3%**. Treat the small startup-time change as local evidence, not a large speed
claim. All first-page hashes match. The later focus comparison uses the same 20 evenly distributed
raw units in each of three processes; all focus result hashes match too.

A fresh retained-evidence 1× build took **88.08 s before and 85.76 s after**; peak Node RSS was
approximately **2,616 / 2,575 MiB**. This is one observation per version, not a significant cold-index
speed improvement. Both read 16,500 package records and parse 21 localization files. This case
excludes native discovery and extraction and must not be advertised as an actual Unreal project scan.

## What still needs work

The mechanical cold builder remains the largest opportunity. I inspected the separate
`feat/game-text-native-index` experiment: its retained implementation writes `UESHT003`, while
production requires `UESHT004` and WTF-8 fidelity. Its historical timings are not fresh results
from this session and are not included as a before/after experiment above. Adopting it requires
codec, publication/locking, invalidation, cancellation and pinned-reader parity before its speed
can justify replacing the current builder. Keep join/review policy in the shared domain package.

Full Quality checks still hydrate legacy corpus, join and localization-evidence objects. The
evaluation improvements here do not remove that memory and latency risk. A bounded column-driven
or worker-owned quality pass is a separate project and needs an oracle covering complete reports.
Search-worker and main-thread readers also retain separate numeric projections; sharing immutable
buffers is worth a separate measured experiment rather than an unverified transport rewrite.

## Verification and replay

Native Clippy passes with warnings denied; native tests pass **108**, with one intentionally ignored.
The final focused TypeScript suite passes **68 tests in eight files**, including **1,000 differential
join/query seeds**, raw focus, Unicode queries, pinned-reader reuse and changed-bundle recovery.
Precommit and the Effect architecture checker pass. Saved-package extraction on retained **UE 5.7
and UE 5.8** fixtures matches baseline output: four packages and 22 occurrences for each version.
These are saved-byte checks, not fresh live editor or codegen runs; those sources are unchanged.

The maintained harness uses public libraries and fresh processes, validates replies and compares
page hashes. Build both revisions, then supply their explicit artifacts:

```powershell
node --import tsx scripts/benchmark-game-text-pipeline.ts `
  --project <read-only-project> --reader <after-uasset> `
  --before-reader <before-uasset> --before-module <before-dist/index.js> `
  --output test-results/game-text-paired.json --runs 3
```

For an existing generated 1× index, add `--target Generated --cache <existing-cache>
--records <retained-package-record-directory>`. The retained adapter fails if packages unexpectedly
need rereading. That mode measures the TypeScript warm path and excludes native enumeration.
The maintained harness reports post-GC checkpoint memory, not the independent sampled RSS used
in this investigation. Its generic fixture smoke test passes page-hash parity in both revisions.
