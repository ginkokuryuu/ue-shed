# Native Game Text preparation

`@ue-shed/game-text` exports an opt-in `nativeIndexBuilderLayer(readerConfiguration)` implementing
the existing `GameTextIndexBuilder` service. Replace `typeScriptIndexBuilderLayer` in the host's
composition to select it. The default remains TypeScript. Both implementations work headlessly;
Workbench has no special role in selecting or running the writer.

```ts
import { Layer } from "effect";
import { gameTextIndexRefreshLayer, nativeIndexBuilderLayer } from "@ue-shed/game-text";
import type { AssetReaderConfiguration } from "@ue-shed/unreal-assets";

declare const cacheRoot: string;
declare const readerConfiguration: AssetReaderConfiguration;

const refresh = gameTextIndexRefreshLayer(cacheRoot).pipe(
	Layer.provide(nativeIndexBuilderLayer(readerConfiguration))
);
```

Supply the ordinary source and localization evidence layers as usual. The native reader must
support `game_text_index` in uasset-io protocol 1.13. The adapter uses the existing scoped protocol
session, configured deadlines, cancellation and bounded output transport. It has no environment
switch or second executable, and does not silently switch writers after a session failure.

## Ownership and compatibility

One build session owns one native child and writer lease. Existing TypeScript package and
localization producers supply prepared layers through a leased writer adapter. Rust publishes the
shared dictionary, input layers, joined projections and compaction. Scope finalizers release the
lease and process; an operation failure invalidates the lease and requires a new session. Search,
facets, focus and lazy projections still use the existing JavaScript readers.

The writer uses the existing format-4 directory, atomic root publication, string generations and
reader pins. Project views share input layers and retain independent joined pointers. Native
joined keys start with `joined-native-v1:`. Switching between native and TypeScript builders
rebuilds that joined view once while reusing inputs. This also prevents a reader's persisted
physical column projections from colliding across builder layouts.

Root and consumed payload checksums remain verified. Selective reads validate segment metadata and
touched sections rather than scanning every unused cached payload on each writer acquisition.
This is ordinary cache validation, not a full integrity scrub. Corrupt disposable caches still
require normal recovery.

## Incremental work and bounds

The native interner probes immutable A64 dictionary fences for unresolved strings. Full cold
construction and full joins still allocate in proportion to their inputs; this is not a claim of
constant memory for an arbitrary cold corpus.

The narrow incremental join retains stable row identity, structure, cardinality and visibility.
Source patches require both old and new strings to have at least 40 UTF-16 code units and reject
sources shared outside the affected rows. PO patches require stable identity, order and context.
The patch cap is 8,192 edits. Unsupported changes, generation changes, missing persisted source
state, changed dependencies and other failed eligibility checks rebuild the joined layer. Numeric
column scans still occur; eligible edits are not constant-time operations.

The adapter stages at most 8,192 intern strings or 16 MiB per batch, with a 1 MiB per-string limit.
Selected-string reads use batches of 32 and a 32 MiB response-file cap. Join input is capped at
32 MiB. A code-unit sidecar preserves unpaired UTF-16 in text and policy keys across JSON/Rust;
valid Unicode keeps its ordinary representation. Input files and results cross validated typed
boundaries. Temporary staging is scoped to the cache operation.

Native outcomes expose actual section/index/write byte counters and named stage durations.
Existing TypeScript-only substage metrics can be zero for this backend; they are not a complete
native phase attribution. Native operation spans carry the stage durations.

## Measurement scope

The isolated prototype compared an owned-buffer TypeScript control, a first native writer and an
incremental native writer. On the larger private dataset, one eligible source edit took 299 ms,
13,311 ms and 186 ms respectively. These measurements exclude package discovery, extraction,
model publication and UI work. They are evidence for the implementation direction, not fresh
measurements of this public protocol adapter.

The prototype's three warm Workbench runs took 7.477, 8.931 and 7.480 seconds; reopen took 10.193,
11.760 and 10.392 seconds. Inventory pagination, materialization and path sorting accounted for
about 4.3 seconds outside the writer. Query execution remained JavaScript: distinct-query requests
were about 39 ms, repeated queries about 2 ms, and repeated IPC requests about 3 ms. Typing also
includes the host's 120 ms debounce. These numbers make no native query-speed claim.

Production checks cover cold and eligible incremental builds, structural fallback, PO updates,
query/facet parity, arbitrary UTF-16, pinned readers, compaction, failed sessions, lease exclusion
and generated join-policy cases. Broader policy/data-shape coverage and cancellation soak testing
remain appropriate before considering a change to the default builder.
