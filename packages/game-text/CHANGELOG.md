# @ue-shed/game-text

## 0.11.0

### Minor Changes

- 500a950: Check the text in a change's files before it is submitted. `localizationGateTarget` judges every
  line whose text lives in a list of changed files: a key change that would lose translations, one
  key with two texts, and translated text that changed fail by default; untranslated changes, text
  not gathered yet, text without a reliable key, removed text and changed source files warn.
  `localizationGateFailures` applies a project's `failOn` and `warnOn`, and `LocalizationGateResult`
  is the verdict across targets. The CLI exposes it as `ue-shed loc gate`.
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

- f38f36f: Add an injectable GameTextIndexBuilder capability and a TypeScript fallback layer for localization import, saved package text, dictionary maintenance and joined target publication. The shared refresh service uses the selected builder and retains published reader generations while inputs and review state refresh under one writer lease.

    Add a columnar implementation of the existing TextCorpusQuery API, including search, facets, filters, pages, focus and exports. Its private joined query projections rebuild derived caches under a new joined key. CLI and Workbench adopt it in this release with lossless WTF-8 string storage.

- 580442c: Serve CLI and Workbench Game Text queries from a shared column index through one refresh service
  and an injectable builder capability. Preserve existing pages, filters, facets, focus and reports;
  refresh changed packages and localization files, and invalidate affected layers after writes.
  Retain bounded reader generations and remove the large-heap setup requirement from the docs.
- 2f4a3aa: Store every Game Text index layer on one shared, append-only string store per project and
  target, with compaction once unused strings pass a threshold. Layers hold compact ID columns.
- 621f9f3: Add a compact Game Text snapshot format and a Node snapshot store. Sections are checksummed,
  compressed and loaded only when first used, and publishing is atomic under one writer lock.
  CLI and Workbench use the store through the shared refresh service in this release.
- 656ecf5: Import Unreal manifest, archive and PO files into Game Text snapshots by streaming, keyed by
  content hash, with a file-stat check that skips unchanged files without opening them. The PO
  parser exposes block decoding for streaming callers and takes a faster path for unescaped fields.
- fc996e5: Saved investigations can name a localization target. `GameTextInvestigationQuery` gains an
  optional `localization` selection, and `exportGameTextInvestigation` takes the target's query, so
  problem and translation filters export the lines the list shows; a preset that names a target
  whose files are not supplied fails with guidance instead of throwing. Key changes pair by text
  alone only when no other line on either side has that text, and baseline comparison follows the
  same rule.
- 82be00c: Filter Game Text by where text comes from. Search requests accept `where` with origin kinds
  (String Table, DataTable, asset, C++, other gathered source) and a path prefix, applied to saved
  units and gathered-only localization lines alike. Search counts add `origins`, which excludes the
  origin filter itself. `where.files` keeps the text a changed-file list touches, and the page's
  `fileScope` summarizes the list. `text-origin.ts` exports the pure classifiers and file helpers.

    Pair localization keys that changed with the key Unreal still lists: by the same saved place, the
    same text in the same asset, or text unique in the project, strictly one to one. Lines carry
    `keyChange`, selections accept `keyChanged`, and pages count new keys.

    Baselines record each line's manifest path, and baseline comparison reports `keyChanged` pairs
    instead of counting them as added and removed. `localizationKeyChangesAcross` pairs keys across
    a gather.

    Export one spreadsheet with every language: `localizationLinesCsv` writes a row per line with a
    translation and state column per culture, native first, missing translations as empty cells, in
    code-unit order. `textCorpusQuery` adds an unpaged `localizationLines(request)`.

- b6f65d6: Classify every line by problem and filter with clauses. `TextProblem` lists problems worst first
  (key changed, same key with different text, not gathered, changed since gather, translation work,
  finding, up to date), and search pages add `problems`, counted without the request's problem
  clauses. Requests accept `filter`, a list of `{ field, op: "is" | "is_not", values }` clauses over
  problem, finding, translation state, origin, folder, editing and translator notes; the existing
  request fields keep their meaning. Localization selections accept `cultures`, a culture set that
  scopes states, counts and translation work. `text-problems.ts` exports the pure classification and
  matching.

    Group and facet the matching lines. Requests accept `group` (problem, folder, asset, origin or
    namespace), `openGroup` and `facets`; pages add `groups`, worst first and bounded at 200 with a
    count of the rest, and `facets` with folders a level at a time, assets, origins and per-culture
    work. Clauses add `asset` and `namespace`. `text-groups.ts` exports the pure grouping, and
    `textFileLabel` spells a file the way the project does.

    Investigation presets accept optional `filter` and `group`; presets saved before them still open.

    Search requests accept `lines`, up to 5,000 localization line ids, to act on a selection.
    `localizationLinesCsv` accepts `cultures` and then keeps the native culture plus those columns;
    `pickedLocalizationCultures` reads the picked cultures from a localization selection.

    Joining a large localization target is much faster: a 50,000-line, 14-culture target joined in
    about 30 seconds and now joins in about 1.5 seconds, and per-culture counts take one pass.

- 9b08c67: Aggregate saved-text gaps by package without losing reader reasons, retain at most three samples,
  and count all undecoded properties. Add optional `coverageGapCounts` to corpus diagnostics while
  keeping corpus schema version 1. Bound report diagnostics and incomplete package lists to 200,
  with full totals and omitted counts in status, progress, quality and investigation output.

    Expose a browser-safe text coverage gap schema from Unreal Assets for corpus consumers.

### Patch Changes

- 982743f: Raise localization evidence and saved-reader limits tenfold, apply entry limits per file, and preserve read failure causes and recovery guidance in Game Text and the CLI.
- 8de142d: Add scoped worker-backed compact-index search for desktop and trusted Node hosts. Cancel replaced
  scans without evicting completed results, and reuse prepared WTF-8 source bytes for case-insensitive
  search. Preserve translations in schema-validated text-unit previews.

    Treat failed current localization inputs as unavailable instead of reusing historical layers.
    Preserve empty-source units in raw corpus hydration. Separate retained-model publication from
    reader retirement and keep outstanding query users pinned through replacement.
    Reject superseded desktop refreshes after localization cleanup and serialize model publication.

- bf14f9d: Add a persistent localization merge join over shared package and localization ID columns,
  including review state, key changes, problems and facets. Stable package source and PO edits
  refresh affected identities through a bounded overlay; other edits rebuild the join.
- 580442c: Preserve lone UTF-16 surrogates in every Game Text index string domain using canonical WTF-8. Disposable snapshot format v4 rebuilds older caches and rejects malformed or non-canonical byte sequences. Search, findings and joined query projections retain the original code units.
- f38f36f: Derive compact localization findings and facets from each gathered slice's searchable source and
  contexts. Split saved identities no longer leak long-text or conflicting-source findings, origin,
  editing capability, notes, files or folders into another line. Empty slices contribute no query
  facets. Older joined caches rebuild automatically; the public query contract is unchanged.
- d664bc2: Refresh stable package source edits incrementally when localization source conflicts are created,
  changed or resolved. Preserve full-rebuild states and query projections with bounded source-list
  patches over one retained base snapshot.

    Reuse immutable query columns and encoded source bytes across incremental refreshes while keeping
    patched values and older readers isolated. Rebuild the source search arena when reuse bounds are
    exceeded or the dictionary generation or full base changes.

- 580442c: Share typed localization failure recovery between the event reader and streamed index importer.
  Malformed manifests, archives and PO files retain the existing recovery guidance through indexed
  CLI and Workbench workflows, with file and position details from the streaming reader.
- 580442c: Match UE 5.7 and 5.8 localization loaders by rejecting escaped unpaired UTF-16 surrogates in manifests and archives. Both the event parser and streaming index importer report the file, character offset, and typed malformed-manifest or malformed-archive failure. Saved package strings remain lossless WTF-8.
- fb4a3ed: Add the package-text layer to the shared string store, with occurrence ID columns, per-package
  coverage and gap samples, signature-keyed refresh, parallel cold preparation, and a reusable corpus
  oracle adapter. Preserve unchanged packages and publish affected shards together atomically.
- af462fb: Preserve the native reader's sorted package-path order when folding conflicting localization sources from the compact index, including layer-hydrated corpora. Rebuild older joined layers automatically.
- 580442c: Expose bounded, generation-checked Project Index inventory pages with opaque package and sidecar signatures and saved header gather eligibility. Game Text refreshes use this committed inventory; Workbench reuses its project refresh instead of enumerating disk again.
- 02b5128: Match saved text carrying Unreal package namespaces to gathered localization identities, so
  translations, key changes, review fingerprints and gates use the same namespace and key as Unreal.
  Preserve full saved namespaces for asset inspection and detect shared identities and source
  conflicts across packages without false duplicate-source findings.
- a844652: Focus localization lines on their own saved occurrences, preserving corpus unit IDs and plain
  corpus focus while keeping detail sources, locations and review signals aligned with previews.
- Updated dependencies [982743f]
- Updated dependencies [1f01e74]
- Updated dependencies [6218a5c]
- Updated dependencies [580442c]
- Updated dependencies [580442c]
- Updated dependencies [580442c]
- Updated dependencies [23c8d9c]
- Updated dependencies [02b5128]
- Updated dependencies [67a611c]
- Updated dependencies [656ecf5]
- Updated dependencies [9b08c67]
    - @ue-shed/localization@0.11.0
    - @ue-shed/unreal-assets@0.11.0

## 0.10.0

### Minor Changes

- 8d812df: Add pure Unreal localization quality checks, provenance-bearing version-1 change-set proposals,
  and `ue-shed loc check` with optional exclusive proposal JSON creation.
- 980ad73: Add compatible v2 culture budgets and glossaries, archive progress reports, and versioned manifest
  source baselines. Expose `loc report` with exclusive baseline creation and preserve v1 source rules.
- bbe2501: Join saved text with read-only Unreal localization evidence by namespace and key. Add coverage-qualified
  per-culture states, bounded localization query pages, translation search, state and word counts, and
  file evidence reports. Preserve String Table translator comments alongside developer notes.
- 64976b1: Track localization review state in a project-owned review file per target. Records keep reviewed,
  proofread, approved and machine translated flags against a fingerprint of the source and the
  translation that ships next, so later edits read as changed since review. Game Text adds review
  lenses, accepted check findings and reviewed and proofread report shares.
- 271dcd1: Write reviewed translation change sets into PO files. Changes are revalidated against fresh
  evidence: the source must match the manifest, and the replaced translation must match what ships
  next. Only the edited `msgstr` values change, through an atomic, hash-guarded replace. Game Text
  adds browser-safe edit request and result schemas for hosts that stage edits.

### Patch Changes

- Updated dependencies [8d812df]
- Updated dependencies [f66ac19]
- Updated dependencies [bdbcaec]
- Updated dependencies [64976b1]
- Updated dependencies [271dcd1]
    - @ue-shed/localization@0.10.0
    - @ue-shed/unreal-assets@0.10.0

## 0.9.3

No direct behavioral change. Align with the UE Shed 0.9.3 suite and exact internal dependency pins.

### Patch Changes

- @ue-shed/unreal-assets@0.9.3

## 0.9.2

### Patch Changes

- @ue-shed/unreal-assets@0.9.2

## 0.9.1

### Patch Changes

- @ue-shed/unreal-assets@0.9.1

## 0.9.0

### Minor Changes

- 3d4c6b1: Keep saved FText translator notes. Keyed text and StringTable entries saved by UE 5.8 expose
  `dev_notes` in `readSavedAsset` inspection output and compact text extraction, and Game Text
  exposes them on each `TextOccurrence.devNotes`, separate from the source string and localization
  identity. Older packages and empty notes produce `""`. `readSavedTable` text cells are unchanged.

### Patch Changes

- Updated dependencies [b8c7623]
- Updated dependencies [679d972]
- Updated dependencies [e5c5811]
- Updated dependencies [3d4c6b1]
    - @ue-shed/unreal-assets@0.9.0

## 0.8.0

### Patch Changes

- 64ca9bf: Inspect rich curve keys, Skeleton reference poses and bone indices, Sequencer float/double channels,
  bounded InstancedStruct values, and package/object metadata in UE 5.7 saved packages. Share the
  source-derived native layouts across native and WASM readers and preserve unsupported inner payloads.
- 64ca9bf: Use source-derived Unreal class and serialization models for supported saved assets. Share bounded
  native layout decoding between StringTables and enums, expose StringTable metadata in native and
  WASM inspection, and preserve saved string-table text identities.
- Updated dependencies [64ca9bf]
- Updated dependencies [64ca9bf]
- Updated dependencies [64ca9bf]
    - @ue-shed/unreal-assets@0.8.0

## 0.7.1

Align this package with the synchronized UE Shed 0.7.1 suite and exact internal dependency pins. There is no direct behavioral change.

### Patch Changes

- @ue-shed/unreal-assets@0.7.1

## 0.7.0

### Patch Changes

- @ue-shed/unreal-assets@0.7.0

## 0.6.0

### Minor Changes

- ff117a0: Add versioned Game Text investigation presets and complete filtered JSON/CSV exports, retaining
  text identities, all occurrences, quality rules, coverage, and project provenance. Query models
  can export full matching results independently of paginated UI results.

    Expose browser-safe investigation metadata and CSV helpers, plus a separate Node file adapter
    with bounded preset reads and atomic output writes. Workbench and the CLI use these APIs for
    saved investigations and replay against an explicitly selected project.

### Patch Changes

- Updated dependencies [ff117a0]
- Updated dependencies [efb6898]
- Updated dependencies
- Updated dependencies [ff117a0]
    - @ue-shed/unreal-assets@0.6.0

## 0.5.1

### Patch Changes

- Align this package with the synchronized UE Shed `0.5.1` patch release. There is no direct
  behavioral change.

- @ue-shed/unreal-assets@0.5.1

## 0.5.0

### Patch Changes

- @ue-shed/unreal-assets@0.5.0

## 0.4.0

### Patch Changes

- @ue-shed/unreal-assets@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [bf27d37]
    - @ue-shed/unreal-assets@0.3.0

## 0.2.0

### Patch Changes

- 51c0e1b: Align the unchanged public packages with the synchronized UE Shed `0.2.0` suite release.
- Updated dependencies [51c0e1b]
    - @ue-shed/unreal-assets@0.2.0

## 0.1.0

### Patch Changes

- 9c2cdce: Publish the stable 0.1 package set, including the headless Game Text and World Log Map History
  integration packages.
- Updated dependencies [9c2cdce]
    - @ue-shed/unreal-assets@0.1.0
