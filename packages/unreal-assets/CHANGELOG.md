# @ue-shed/unreal-assets

## 0.12.0

### Patch Changes

- d99dcf6: Share scoped query workers across overlapping immutable index readers. Workbench prepares one
  target-first model for source and localization browsing, validates inputs before reusing it, and
  retains unchanged workers across rescans. Keep result rows and loaded pages stable with Solid 2 keys.
  Expose an optional opaque query identity on validated target handles and their opened models so
  hosts can reuse a model without constructing storage identifiers. Correct Game Text's Node range
  to `^22.15.0 || >=23.8.0`, matching the built-in Zstd APIs required by its Node entry point.
  Replace failed query workers on unchanged refreshes while preserving healthy sharing and existing
  reader pins; retiring a failed worker cannot evict its replacement.

    Reduce saved-text extraction working memory with bounded ordered native delivery and concurrent
    path validation. Keep package signature checks before and after reads while running them with
    bounded concurrency. Warm bounded query pages instead of every column, reduce source-arena
    retention, and accelerate Unicode search rejection, quality evaluation and raw-unit focus.

    Start cold localization parsing with input-size memory reservations rather than a blocking
    largest-file probe. Prepare bounded string-sort runs in workers, batch large cold package reads,
    convert larger staged layers in workers, and retain only two decoded identifiers while sorting
    joined query IDs. Small package sets and small layer mappings keep their existing preparation path.

    Persist a bounded optional source-query projection so reopened readers can reuse verified source
    bytes, ASCII flags and trigram membership. Preserve pinned readers and update the projection across
    source overlays. Match review records by numeric identity and sort joined identifiers in bounded
    locale runs with a stable merge.

- Updated dependencies [d90ae25]
    - @ue-shed/protocol@0.12.0

## 0.11.0

### Minor Changes

- 1f01e74: Add the opt-in uasset-io v1.8 package-text extraction operation and public reader stream.
  Each decoded package carries occurrences, complete gap counts and at most three diagnostic
  samples. Preserve the existing extraction stream and add a corpus adapter for package records.

    Negotiate uasset-io v1.9 package flags and gatherable-text summary count/offset in saved headers and Project Index
    header pages. Rebuild disposable Catalog caches for header profile 2. Candidate helpers use
    Unreal's gather flag, non-empty summary and saved external-package relationships; the fixture
    audit proves that TextProperty adds no candidates and every decoded occurrence is retained.

    Add optional corpus coverage for `not_gatherable` packages and exclusion diagnostics, retained
    in bounded localization status reports and Game Text coverage notes, with an optional excluded
    count in validated query summaries. This release also adopts the signature-keyed shared
    package-text layer in CLI and Workbench.

- 580442c: Expose bounded, generation-checked Project Index inventory pages with opaque package and sidecar signatures and saved header gather eligibility. Game Text refreshes use this committed inventory; Workbench reuses its project refresh instead of enumerating disk again.
- 67a611c: Saved-world reads now produce contract 2.1, which only adds optional fields. Each actor reports
  `decode` (`partial` when its export or a subobject failed or kept a property value undecoded), its
  saved `parentComponent`, and `heldBy` when a child-actor component that names it in `ChildActor`
  belongs to another saved actor. The result lists every unreadable package or export in
  `packageErrors`, with its category, detail and whether an actor may have been lost, instead of only
  counting them in a diagnostic. Exports that decoded with undecoded property values are summarized in
  one `skipped_property` entry per package, with `count`, `exports` and the most frequent types; they
  do not make the package partial. `uasset saved-world --skipped-properties export` lists one entry
  per export instead. 2.0 documents still decode; consumers that pin `minor: 0` must accept `1`.

    The reader decodes `FIntPoint`, `FColor`, `FLinearColor`, `FBox2D` and `FMatrix` inside arrays,
    sets and maps, where they are always binary. An unknown struct inside a container decodes as a
    tagged stream only when the container's tag proves it; otherwise only its property is skipped, with
    the reason recorded, rather than failing the export or guessing. Landscape heightmap edge-fixup exports, which hold only native binary, are
    skipped instead of reported as failures.

### Patch Changes

- 982743f: Raise localization evidence and saved-reader limits tenfold, apply entry limits per file, and preserve read failure causes and recovery guidance in Game Text and the CLI.
- 9b08c67: Aggregate saved-text gaps by package without losing reader reasons, retain at most three samples,
  and count all undecoded properties. Add optional `coverageGapCounts` to corpus diagnostics while
  keeping corpus schema version 1. Bound report diagnostics and incomplete package lists to 200,
  with full totals and omitted counts in status, progress, quality and investigation output.

    Expose a browser-safe text coverage gap schema from Unreal Assets for corpus consumers.

- Updated dependencies [1f01e74]
- Updated dependencies [a545cd5]
- Updated dependencies [580442c]
- Updated dependencies [67a611c]
    - @ue-shed/protocol@0.11.0

## 0.10.0

No direct behavioral change. Align with the UE Shed 0.10.0 suite and exact internal dependency pins.

### Patch Changes

- Updated dependencies [8e83f1a]
- Updated dependencies [5fd5bc7]
    - @ue-shed/protocol@0.10.0

## 0.9.3

No direct behavioral change. Align with the UE Shed 0.9.3 suite and exact internal dependency pins.

### Patch Changes

- @ue-shed/protocol@0.9.3

## 0.9.2

### Patch Changes

- @ue-shed/protocol@0.9.2

## 0.9.1

### Patch Changes

- Updated dependencies [ce281fb]
- Updated dependencies [ce281fb]
    - @ue-shed/protocol@0.9.1

## 0.9.0

### Minor Changes

- b8c7623: Add saved Blueprint and Sequencer review through the public reader, CLI, and Workbench:
  typed Level Sequence reads, reference inventory and resolution, and bounded comparisons with
  explicit incomplete evidence. Validate richer Blueprint graphs and regenerated sequences on
  Unreal 5.7 and 5.8. Include native property-bag decoding and saved animation summaries.
- 679d972: Decode boolean container bytes correctly and expose saved bool, integer, byte/enum, and visibility
  channels through Level Sequence schema 5. Preserve omitted defaults, channel flags and enum references;
  extend native/WASM, comparison, and Unreal 5.7/5.8 conformance.
- e5c5811: Expose shared Sequencer settings, scoped camera cuts, binding metadata and saved string/object
  channels through schema 6. Add Blueprint variable declarations, saved CDO overrides and component
  hierarchies/templates through schema 2. Publish bounded contracts and update native/WASM readers,
  reference navigation, comparisons and viewers with independent UE 5.7/5.8 fixture conformance.

    Decode source-checked inherited actor/component native records, including saved construction-script
    member references and conditional scene flags. Expose native evidence separately from tagged
    properties and include it in Blueprint comparisons/navigation and Sequencer reference coverage.

- 3d4c6b1: Keep saved FText translator notes. Keyed text and StringTable entries saved by UE 5.8 expose
  `dev_notes` in `readSavedAsset` inspection output and compact text extraction, and Game Text
  exposes them on each `TextOccurrence.devNotes`, separate from the source string and localization
  identity. Older packages and empty notes produce `""`. `readSavedTable` text cells are unchanged.

### Patch Changes

- Updated dependencies [a3b58fd]
- Updated dependencies [f69d878]
- Updated dependencies [b8c7623]
- Updated dependencies [679d972]
- Updated dependencies [e5c5811]
- Updated dependencies [3d4c6b1]
    - @ue-shed/protocol@0.9.0

## 0.8.0

### Minor Changes

- 64ca9bf: Inspect rich curve keys, Skeleton reference poses and bone indices, Sequencer float/double channels,
  bounded InstancedStruct values, and package/object metadata in UE 5.7 saved packages. Share the
  source-derived native layouts across native and WASM readers and preserve unsupported inner payloads.
- 64ca9bf: Use source-derived Unreal class and serialization models for supported saved assets. Share bounded
  native layout decoding between StringTables and enums, expose StringTable metadata in native and
  WASM inspection, and preserve saved string-table text identities.

### Patch Changes

- 64ca9bf: Reduce native parser allocation costs by borrowing struct names, formatting diagnostic paths only
  on failure, and reading sized arrays without cloning generated layouts. Reduce owned inspection
  memory for assets without Skeleton poses while preserving inspection JSON and analyzer behavior.
- Updated dependencies [1a60713]
- Updated dependencies [8c0d895]
- Updated dependencies [64ca9bf]
- Updated dependencies [33d9c5f]
- Updated dependencies [23d243a]
- Updated dependencies [2104cb1]
- Updated dependencies [b0d2955]
- Updated dependencies [64ca9bf]
- Updated dependencies [2104cb1]
    - @ue-shed/protocol@0.8.0

## 0.7.1

Align this package with the synchronized UE Shed 0.7.1 suite and exact internal dependency pins. There is no direct behavioral change.

### Patch Changes

- @ue-shed/protocol@0.7.1

## 0.7.0

### Patch Changes

- Updated dependencies [1c03e0f]
    - @ue-shed/protocol@0.7.0

## 0.6.0

### Minor Changes

- ff117a0: Add generation-bound Project Index counts through
  `countProjectIndex({ projectId, expectedGeneration, filters })`. Supply 1–16 `ProjectIndexFilter`
  values for maps, exact classes, class prefixes, class-name suffixes, or serialized names. Each
  value-based filter requires 1–64 non-empty values; empty filter lists are rejected. Overlapping
  matches count each package once. The production binary Catalog reads checked snapshot postings
  without transferring candidate headers, and the public helper validates result identity and generation.
- Inspect saved Blueprint graphs without launching Unreal through `readSavedBlueprint`, native IO,
  and the WASM inspection API. Return graph/node identities, saved positions, typed pins and defaults,
  canonical links, tagged node properties, and explicit coverage diagnostics. Inspection is read-only
  and limited to supported uncooked saved revisions; it does not compile or execute Blueprints.

    Improve Project Index discovery, header batching, refresh, and query transport. Bound native
    protocol-worker shutdown and preserve typed reader failures for recovery.

- ff117a0: Add versioned Game Text investigation presets and complete filtered JSON/CSV exports, retaining
  text identities, all occurrences, quality rules, coverage, and project provenance. Query models
  can export full matching results independently of paginated UI results.

    Expose browser-safe investigation metadata and CSV helpers, plus a separate Node file adapter
    with bounded preset reads and atomic output writes. Workbench and the CLI use these APIs for
    saved investigations and replay against an explicitly selected project.

### Patch Changes

- efb6898: Preserve native failure codes on `AssetReaderError` so clients can provide typed recovery for unsupported and unavailable readers, and expose Blueprint class evidence for Project Index candidate queries.
- Updated dependencies [9bd7735]
- Updated dependencies [ff117a0]
- Updated dependencies [2f1137a]
- Updated dependencies [2760900]
- Updated dependencies
    - @ue-shed/protocol@0.6.0

## 0.5.1

### Patch Changes

- Align this package with the synchronized UE Shed `0.5.1` patch release. There is no direct
  behavioral change.

- @ue-shed/protocol@0.5.1

## 0.5.0

### Patch Changes

- @ue-shed/protocol@0.5.0

## 0.4.0

### Patch Changes

- @ue-shed/protocol@0.4.0

## 0.3.0

### Minor Changes

- bf27d37: Version the saved-world projection to v2 with finite effective location, quaternion rotation, scale,
  and direct root-component attachment evidence. Map History schema v2 records the new actor shape and
  distinguishes attachment, effective-transform, and transform-resolution changes.

### Patch Changes

- Updated dependencies [bf27d37]
    - @ue-shed/protocol@0.3.0

## 0.2.0

### Patch Changes

- 51c0e1b: Align the unchanged public packages with the synchronized UE Shed `0.2.0` suite release.
- Updated dependencies [51c0e1b]
    - @ue-shed/protocol@0.2.0

## 0.1.0

### Patch Changes

- 9c2cdce: Publish the stable 0.1 package set, including the headless Game Text and World Log Map History
  integration packages.
- Updated dependencies [9c2cdce]
    - @ue-shed/protocol@0.1.0
