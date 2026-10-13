# 0010: Bounded Game Text preparation and query caching

## Status

Accepted by the owner on 2026-10-13 after the pipeline, cold-index and cache-budget experiments.
This records the retained implementation in performance PR #67, stacked on UX PR #66.

## Decision

Use the shared Game Text library pipeline for every host. Retain bounded Rust extraction,
concurrent signature verification, size-weighted cold parsing, parser-prepared string runs and
worker conversion of larger layers. The coordinator owns global IDs, writer leases and atomic
publication. A large first task starts with the other eligible tasks; it is not a serial memory
probe. Reservations estimate memory rather than guarantee process RSS.

Keep bounded page warming, numeric focus and review lookup, stable locale sorting in bounded
runs, and the quality-evaluation changes that remove repeated preparation and quadratic copying.
Preserve exact query order, Unicode/WTF-8 fidelity, typed recovery and pinned-reader behavior.

Full joins may persist the verified source projection, lowercase-ASCII flags and trigram membership
in their existing immutable snapshot. Use the thresholds, storage bounds and overlay policy in
[Game Text snapshots](../engineering/game-text-snapshots.md). Optional-cache absence falls back to
the dictionary path. The measured 81.8 MiB cache is the accepted choice for the retained 1× fixture;
150 MiB is this experiment's allowance, not a new product quota or a target to fill.

Keep the current compression policy. Do not retain flat dictionary mirrors, blanket raw storage,
the extra source-facts RAM cache, blanket lazy queries or the smaller decoded-frame cache default.
Their overall results did not justify the storage, memory or interaction cost.

`typeScriptIndexBuilderLayer` remains the current tested builder and oracle. The separate native
builder is not adopted by this decision. A replacement must demonstrate format, lifecycle,
invalidation, cancellation, query and policy parity through the shared capability boundary.

## Evidence and consequences

The [consolidated experiment record](../research/game-text-pipeline-performance-2026-10-13.md)
retains the before/after measurements and rejected trials. The latest repeated comparison improves
cold readiness from 72.55 to 69.14 seconds and reopening from 3.347 to 2.450 seconds for about
2.7 MiB more persisted data. Matching searches have no general improvement; one sparse search is
about 5 ms slower. Cold RSS ranges overlap.

Future changes should measure the complete affected path, cache bytes and sampled process memory
alongside isolated stages. Compare the same inputs in alternating fresh processes and verify
result hashes. Do not add timings from different workloads or present worker work totals as stage
wall time. Spare disk allowance alone is insufficient reason to persist another representation.

Performance changes do not broaden gather coverage. The saved scan remains evidence with the
[documented differences from an Unreal gather](../engineering/game-text-gather-coverage.md).
