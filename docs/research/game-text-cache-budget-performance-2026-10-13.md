# Game Text cache allowance experiment — 2026-10-13

The extra 150 MiB allowance improved reopening more than cold construction. The retained cache
is **81.8 MiB**, up from **79.1 MiB**. The larger storage experiments did not justify their cost.
These changes belong to performance PR #67, stacked on UX PR #66.

## Repeated public pipeline measurements

The baseline is commit `87489f75`. Both versions use the retained generated 1× project:
16,500 package records, 21 localization files, ten cultures and 583,507 lines. Native discovery
and extraction are excluded. Three alternating fresh Node 26.5.0 processes per version use
fresh derived caches and warm OS caches. An independent parent samples process RSS every 10 ms.
Warm runs use those caches in another fresh process; they are unchanged rescans, not a query call
on an already-open reader. Values below are medians. Raw samples are in the adjacent JSON file.

| Operation                                            |      Before |       After |
| ---------------------------------------------------- | ----------: | ----------: |
| Persisted derived cache                              |    79.1 MiB |    81.8 MiB |
| Cold refresh to query readiness                      |     72.55 s |     69.14 s |
| Serial join                                          |     23.78 s |     21.80 s |
| Unchanged refresh/reopen to readiness                |     3.347 s |     2.450 s |
| First no-match search for `text` after reopening     |    39.55 ms |    24.26 ms |
| First no-match search for `Continue` after reopening |    26.50 ms |    22.50 ms |
| First matching search for `velora`                   |    67.67 ms |    66.94 ms |
| First sparse search for `45678` (16 matches)         |    50.78 ms |    55.64 ms |
| Peak Node RSS during cold construction               | 2,463.2 MiB | 2,372.2 MiB |
| Peak Node RSS during unchanged reopening             |   879.0 MiB |   836.5 MiB |

Cold readiness improves **4.7%** and unchanged reopening **26.8%**. Matching searches show no
general improvement; the sparse first search is about 5 ms slower. The cache mainly avoids repeated
source reconstruction and rejects absent ASCII terms. Repeated query hits already use the existing
request cache. Cold RSS ranges overlap: before 2,406.5–2,494.7 MiB, after 2,349.6–2,569.8 MiB.
The lower median is not evidence of a hard memory guarantee.

All six cold comparisons and all six warm comparisons have the same five-page hash:
`097f17aa317f8de46a927e1651407d2e0e1bf3f89f8575ba6133ae812fee730a`.
Six additional comparisons include matching, sparse, multi-term, uppercase and Unicode-whitespace
queries, with identical hash `7e06ad0a562c94c3ac08eab33f2dbfd3f1c94ab418788bc4548c82c87124ffd8`.

The disk allowance applies to the settled derived Game Text cache measured in the preceding
investigation. Native Catalog storage, retained input records, temporary sort/staging files and
other experiment copies are outside this number. This is a measured cache size for this fixture,
not a global filesystem quota across arbitrary projects, targets and pinned generations.

## Experiment ledger

Single trial timings are exploratory unless explicitly described as repeated measurements.

| Trial                                                                      |                                             Before |                                 After | Decision                                                                                                                                                                                 |
| -------------------------------------------------------------------------- | -------------------------------------------------: | ------------------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Numeric review lookup and precomputed state codes                          |                          Review/mark pass 866.6 ms |                              120.9 ms | Keep. Avoid a culture/namespace/key string for every line and culture.                                                                                                                   |
| Bounded locale sort runs and stable merge                                  |    Raw ID sort 1,466.7 ms; line ID sort 1,442.3 ms |                    563.4 ms; 616.5 ms | Keep. Three alternating micro measurements per kind; exact order hashes match. Decode each run once and retain only merge heads.                                                         |
| Persist expanded source bytes, then add ASCII flags and trigram membership | Reopening 3.347 s; no-match `text` search 39.55 ms |                     2.450 s; 24.26 ms | Keep the combined repeated result. Adds about 2.7 MiB on disk.                                                                                                                           |
| Flat bulk dictionary mirrors                                               |          Bulk expansion 1.243 s; no mirror storage | 0.419 s; about 20.5 MiB extra storage | Reject. Mirror creation adds about a second; complete cold trial remains 71.05 s at 102.3 MiB, with no overall advantage over the simpler retained change. Exact bulk bytes/ranks match. |
| Lower all dictionary compression levels to 1                               |            Retained cold median 69.14 s / 81.8 MiB |          One trial 69.96 s / 82.1 MiB | Reject. No measured overall benefit.                                                                                                                                                     |
| Joined snapshot zstd level −1                                              |         Write 549 ms; verify 326 ms; 57.0 MiB file |              606 ms; 338 ms; 56.8 MiB | Reject. Slower publication in this trial.                                                                                                                                                |
| Joined snapshot zstd level −3                                              |         Write 549 ms; verify 326 ms; 57.0 MiB file |              605 ms; 255 ms; 93.1 MiB | Reject. About 71 ms of verification savings for 36 MiB extra in this file.                                                                                                               |
| Joined snapshot zstd level −5                                              |         Write 549 ms; verify 326 ms; 57.0 MiB file |             610 ms; 258 ms; 102.4 MiB | Reject. Similar small read saving, more bytes and slower writing.                                                                                                                        |
| Store poorly compressing numeric joined columns raw                        |         Write 549 ms; verify 326 ms; 57.0 MiB file |              491 ms; 272 ms; 74.9 MiB | Reject. Roughly 112 ms combined savings for 17.9 MiB extra, without a meaningful pipeline win.                                                                                           |
| Store the entire joined snapshot raw                                       |         Write 549 ms; verify 326 ms; 57.0 MiB file |           1,083 ms; 194 ms; 434.3 MiB | Reject. Exceeds the allowance and worsens publication.                                                                                                                                   |

The standalone snapshot policy trials read the same already-encoded joined columns and rewrite
them with another compression policy; they measure file encoding and verification, not full refresh.
The original cache represents roughly 695 MiB of raw snapshot sections, so uncompressed storage
cannot fit the allowance. A first coarse CPU profile overstated the review pass's share; direct
boundary timings identify the actual savings. The unpublished Rust builder worktree was inspected
without changes or adoption. This continuation changes TypeScript-owned derived caching and sorting;
the earlier retained native extraction improvements remain in #67.

## Retained implementation and bounds

Full joins with at least 8,192 distinct sources may persist source IDs, offsets, canonical WTF-8
bytes, ASCII flags and a 256 KiB trigram table. The producer caps combined raw data at 96 MiB and
conservatively caps stored sections at 16 MiB. Existing checksummed snapshot sections and atomic
root publication own the cache. Larger or small-input projections use the existing dictionary path.
Readers validate IDs, ranges, each string boundary and flag codes. Source edits can reuse a pinned
base, append bounded new sources and copy/update the trigram table; old readers retain their buffers.
Compaction remaps the cache IDs with other source columns. Missing trigrams reject only lowercase
ASCII sources; Unicode and uppercase sources retain exact folding and matching.

Locale sorting retains at most 8,192 decoded entries or 4 MiB of encoded bytes per run, with one
oversized identifier allowed alone. Merging retains one decoded head per run and preserves stable
ties. The stored query-order columns are unchanged. Review matching uses numeric namespace/key
maps and retains the previous record precedence and fingerprint policy.

The maintained `scripts/benchmark-game-text-pipeline.ts` now accepts `--records` without `--cache`:
omitting the cache creates an independent fresh directory per process. Passing a cache explicitly
continues to measure reuse. The scoped public-API probes and intermediate artifacts are retained
locally in `out/game-text-perf-20261013-cache/`.

## Verification

`pnpm run check:repository --maxWorkers=4` passes: **2,430 tests passed, 94 expected skips,
326 passing files**. Precommit and the Effect architecture check pass. The separate differential
suite passes **1,000 seeds and nine tests**. Targeted cache/codec tests pass **12 tests**; the five
suites that timed out in the first default-parallel repository attempt pass **71 tests** when
rerun with four workers. That first attempt had 13 timeout failures and no assertion failures;
the complete bounded-worker repository rerun passes without increasing timeouts.

Saved **UE 5.7 and UE 5.8** public-pipeline comparisons each read 5,165 package records and return
61 lines with matching first-page hash
`540f811ac5a1172e4b31a32e4fbcab748a59dbd8a20d26300b4cd5d6cd6961df`.

Detailed verification results are recorded in the adjacent JSON artifact. The targeted cache tests cover
Unicode/lone-surrogate fidelity, malformed ranges and bytes, remapping, an ASCII term newly added
by an overlay, Unicode source edits, fresh readers and retained previous readers. The differential
suite compares against the independent object implementation. Saved UE 5.7 and UE 5.8 pipeline
checks compare native package evidence with the baseline query output. No native parser, live
editor or codegen/WASM matrix change is part of this continuation. Optimization trials finished
within the one-hour allowance; final verification and PR recording continued afterward.
