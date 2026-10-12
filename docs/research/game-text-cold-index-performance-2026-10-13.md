# Game Text cold index continuation, 2026-10-13

The additional experiment window began at 19:02:24 UTC. The retained 1× cold build improves from
**83.63 s to 71.25 s (14.8%)**, using medians of three alternating fresh processes per version.
Median sampled peak Node RSS is **2,610.5 / 2,416.1 MiB**. All six builds read 16,500 package records,
parse 21 localization files and return 583,507 lines. Five query pages per build have the identical
SHA-256 `097f17aa317f8de46a927e1651407d2e0e1bf3f89f8575ba6133ae812fee730a`.

These are retained generic package records and authored localization files, with fresh derived
caches and warm OS caches. Native discovery and asset extraction are excluded. Node is v26.5.0;
the machine reports 32 CPUs and approximately 64 GiB physical RAM. A parent polls process RSS every
10 ms. No heavy checks run alongside the six final measurements. This is not a 10× or studio-project
measurement. Raw samples and exploratory trials are in the adjacent JSON.

| Stage, final paired medians                             |  Before |   After |
| ------------------------------------------------------- | ------: | ------: |
| Localization preparation and publication                | 25.00 s | 16.47 s |
| Localization dictionary sorting                         | 13.25 s |  5.88 s |
| Localization publication, including sort and conversion | 16.88 s |  7.96 s |
| Package preparation and publication                     | 31.72 s | 27.93 s |
| Final join                                              | 24.01 s | 23.61 s |
| Complete refresh to query readiness                     | 83.63 s | 71.25 s |

The stage medians do not sum exactly to the total: separate public boundary work and query opening
are included in readiness. Worker encoding/verification timing counters add elapsed work across
workers, so they must not be presented as wall-clock stage timings.

## Experiment ledger

The isolated trial rows below are single observations, not repeated significance estimates.
The final combined row above has three samples per version.

| Trial                                                                |                                                Before |                                                After | Decision                                                                                                                                                            |
| -------------------------------------------------------------------- | ----------------------------------------------------: | ---------------------------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replace blocking largest-file memory probe                           |                       Localization preparation 8.37 s |                                               6.50 s | Keep. Start immediately with size-weighted reservations based on available memory.                                                                                  |
| Prepare local string runs in parser workers                          | Localization sort 13.37 s; localization total 25.38 s |                                      6.04 s; 18.12 s | Keep. Workers generate bounded runs and reuse hashes; publication does not reread their string blocks.                                                              |
| Convert staged localization layers in workers                        |                                    Publication 9.54 s |                                               8.00 s | Keep for sufficiently large mappings. Coordinator retains the lease and atomic root publication.                                                                    |
| Connect the existing package worker helper to cold refresh           |            Package stage 32.48 s; package sort 6.62 s |                                      27.62 s; 3.92 s | Keep for at least 256 packages. The helper was previously exported but unused by refresh.                                                                           |
| Cache source visibility, lengths and words across join passes        |                  Join 24.70 s; complete build 71.91 s | 23.10 s; 70.98 s, approximately 96 MiB more peak RSS | Reject. Small total improvement with a sizeable extra numeric cache.                                                                                                |
| Retain two decoded IDs during comparisons; reduce run-reader buffers |                       Join 24.70 s in the wired trial |                            Final join median 23.61 s | Keep the bounded alternative. No complete decoded-ID cache; read buffers target 16 MiB total. This row combines two changes and is not an isolated causal estimate. |

The first broad differential run exposed unnecessary worker startup on tiny inputs. It was stopped,
and the policy now leaves package sets below 256 on the existing path and converts mappings below
512 KiB in the coordinator. The measured 1× workload takes the same worker paths after these guards.

## Scope and remaining work

The global merge, dictionary append/probing and final join policy remain serial. Parser reservations
are estimates, not a hard RSS guarantee: half of available process memory is the parser budget,
and each task reserves 128 MiB plus 32 times its input bytes. Oversized files run alone. Layer
conversion uses available-memory reservations, up to eight workers, and transfers only copied
per-layer maps. Final ID comparators retain two strings.

I rechecked the separate Rust cold-builder experiment. It uses a different persisted format and
does not supply the current format/WTF-8/lifecycle contract, so it is not adopted in this hour.
Native global merge/remapping remains a candidate for a separately benchmarked mechanical backend.

`scripts/benchmark-game-text-pipeline.ts` now supports cold retained-record replay and reports
localization, package and join boundary times. Use `--records` for retained evidence, `--target`
for the target, omit `--cache` for fresh derived caches, and provide the archived baseline module
with `--before-module`. Its memory fields are post-GC checkpoints; sampled peaks in this report
come from the independent parent sampler.

## Verification

`pnpm run check:repository` passes: **2,423 tests passed, 94 expected skips, 325 passing files**.
The focused cold/refresh suite passes **52 tests in nine files**. The separate differential suite
passes **1,000 seeds and nine tests**, including query predicates, raw focus, Unicode/lone-surrogate
fidelity and forced/incremental join comparisons. Precommit and the Effect architecture check pass.
The new tests cover size reservations, queue failure, excluded and Unicode package paths, unchanged
reuse, cross-domain ID/hash parity, worker failure types and verified converted sections.

The maintained public pipeline harness passes fresh-cache baseline/current comparisons on saved
**UE 5.7 and UE 5.8 fixtures**: each version reads 5,165 package records and returns 61 lines with
the same first-page hash, `540f811ac5a1172e4b31a32e4fbcab748a59dbd8a20d26300b4cd5d6cd6961df`.
Those checks ran during verification and their elapsed times are not performance headline data.
Native parser/codec code, live editor checks and the codegen/WASM engine matrix are outside this
TypeScript cold-index continuation.

The experiment window was one hour. Final repository verification and PR recording completed
after that window; no additional optimization trials were started during that cleanup.
