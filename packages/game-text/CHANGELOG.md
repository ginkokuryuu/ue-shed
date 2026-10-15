# @ue-shed/game-text

## 0.15.0

### Minor Changes

- 8620750: Report source-level localization findings once per line instead of once per culture. The default
  Quality list changes.
    - `missing_translator_notes` and `duplicate_source` describe the source line, so each now reports
      once per line. The finding belongs to the target's native culture, or the line's first culture in
      the target by code when it has no native one. The all-cultures list counts each line once;
      selecting the native culture shows them; selecting another culture does not. Counts, rule
      summaries, search, export and focus follow, on both `checkLocalizationTarget` and the indexed
      `localizationQuality` scan. The default check set is unchanged; hosts choose checks with
      `checks`, `disabledChecks` or a rule document's `disabledLocalizationChecks`.
    - Saved state still loads: presets that select either filter keep it, and review files keep their
      accepted findings. An acceptance of either check recorded under a non-native culture no longer
      matches a finding and has no effect.

### Patch Changes

- d88c4e7: Keep Unreal's full object paths on Game Text occurrences from UE 4.27 packages. UE 4.27 usually saves
  `None` as a package's name, so the reader names that package's objects relative to it
  (`DT_InventoryItems` rather than `/Game/Data/DT_InventoryItems.DT_InventoryItems`). Role matchers on
  `object_path` and same-package `class_path` values then matched nothing, so source and localization
  rules found nothing on 4.27 projects, and String Table references and key changes could not find
  their entries.
    - The corpus and the index now complete package-relative object paths, class paths and coverage
      gap paths from the package file under `Content/`, which Unreal mounts at `/Game`. Paths that are
      already complete are unchanged.
    - The package text cache format is now `package-text-v3`. Existing caches read their packages again
      on the next refresh instead of reusing stored package-relative paths.
    - Text units without a localization key are identified by object path, so their IDs change on 4.27
      projects.

- 402fa50: Building a full Game Text join no longer fails with `Segment was not requested` when the join's
  source strings were already published in the shared index. The joined source cache now loads the
  string segments it reads instead of relying on the caller to have loaded them first.
- @ue-shed/localization@0.15.0
    - @ue-shed/unreal-assets@0.15.0

## 0.14.0

### Minor Changes

- 8f9bcf1: Saved text coverage now follows the package's own gatherable text table, the list Unreal's asset
  gather reads. A package is partial only when a runtime entry from that table was not decoded;
  undecodable properties that hold no gatherable text (native Niagara structs, for example) remain
  reported as coverage gaps without making the package partial. The table is used only where Unreal's
  gather would use it; Blueprints with bytecode, which are saved without one, keep the previous
  decoder-gap rule. uasset-io v1.10 adds `gatherCoverage` to package text records, Game Text adds
  `coverage.missingGatherableText` and `gatherable_text_not_decoded` diagnostics with the unread
  source text and Unreal site, and user-defined enum display names are now read as text. Entries
  match on namespace, key and source text, so an unread source variant under a decoded key stays
  missing, and authored bracketed namespaces are compared as Unreal saved them. UE 5.8 user-defined
  enums, which save an extra underlying-type byte, now decode instead of failing.
- 10babde: Check localization quality over the index instead of rebuilding the whole target as objects.
    - An opened index now offers `localizationQuality(options, ruleDocument)`. It checks lines in
      bounded pages and keeps findings as columns. Pages, focus and proposals re-check only the rows
      they show.
    - `localizationQualityWorkspaceOf(source, quality)` builds the same workspace over either form;
      `localizationQuality(report, join)` is the in-memory form for adapters without an index.
      `localizationQualityWorkspace(source, report, join)` is unchanged.
    - `checkLocalizationLine` and the per-line policy and accepted-finding helpers expose the checks
      `checkLocalizationTarget` runs, one line at a time.
    - Localization finding IDs are now a fast hash of the finding's line, culture, rule and values.
      They stay stable across rescans of unchanged text; IDs from older versions do not resolve.

### Patch Changes

- 68d49c5: Read localization lines in bulk without re-decoding evidence for every entry.
  `localizationLines` used to hydrate one line per page. Each manifest, archive and PO entry
  re-decoded its file's metadata and zstd string blocks. On a 238k-line, 10-culture target that took
  over 40 minutes before it ran out of memory.
    - Bulk reads now hydrate rows in storage order, in pages of adjacent rows (bridging small gaps), and
      return them in the requested order.
    - Multi-line pages decode each evidence file's rows in sorted runs once per page.
    - Shared string lookups decode in ID order, so each block is decompressed once per lookup.

    Single-line browsing is unchanged.

- c075169: Hydrate localization lines and scan localization quality about twice as fast, in shorter pauses.
    - A page of lines reads its columns, evidence entries and strings once, then builds its lines
      without per-entry Effect or schema work.
    - Evidence entries read from the index are no longer schema-decoded one by one. The importer
      validates Unreal's files when it writes the index, and checksums guard the index's bytes.
    - The quality scan checks 256 lines per page and yields after each, and while it prepares line
      order. On a generated 583,507-line, 10-culture target the longest pause fell from 4–5 s to
      0.5–0.7 s, and the scan from about 205 s to 115 s.

- d8eca33: Upgrade Effect and its integrations to stable 4.0.4. Update renamed schema and configuration APIs,
  JSON Schema validation, synchronous cache queries, retained resource cleanup, and Remote Control
  response handling while preserving authoritative wire contracts and existing workflow behavior.
  Published libraries now require the application to provide `effect@^4.0.0` as a peer dependency,
  and `@ue-shed/observability` also requires `@effect/opentelemetry@^4.0.0`. Install these in the
  application (or reuse compatible existing versions) so UE Shed shares the application's Effect
  runtime. Workspace development and tests remain pinned to Effect 4.0.4 through the catalog.
- Updated dependencies [8f9bcf1]
- Updated dependencies [d8eca33]
    - @ue-shed/unreal-assets@0.14.0
    - @ue-shed/localization@0.14.0

## 0.13.0

### Minor Changes

- d3228d0: Tell missing localization files apart from unreadable ones. A manifest, archive or PO file the
  working copy does not have now reads "Not in this working copy: <path>" with a Gather or Export
  recovery, while files that exist but fail to read keep "could not be read" with their error code.
  Ready `LocalizationTargetResult` values gain optional `fileProblems` and `localizationFolder`;
  `WorkspaceReportPage` gains optional `gatherFilesMissing`, `gatherFileProblems` and
  `localizationFolder`. New exports: `LocalizationFileProblem`, `localizationFileProblems`,
  `explainLocalizationFile`, `localizationEvidenceFolder` and `localizationTargetFiles`.
  `localizationManifestFailure` accepts the manifest's relative path. The generic missing-evidence
  labels no longer claim a read failure.

### Patch Changes

- @ue-shed/localization@0.13.0
    - @ue-shed/unreal-assets@0.13.0

## 0.12.0

### Minor Changes

- 183dd2a: Expose optional, operation-scoped progress for saved package inventory, package extraction,
  localization file preparation, index construction and opening the joined index.

    Share package extraction and strings across a project's source and localization target indexes,
    retain independent joined target views, and reuse signature inventories within a committed
    Project Index generation.

    Expose project opening and refresh, localization import, target construction, and query opening
    as independently composable `GameTextIndexSteps`. Keep the existing refresh service as a
    compatibility wrapper, provide a retainer for host-owned compositions, and replace encoded
    target storage keys with explicit project views.

    Reject superseded localization observations, including failed inputs repaired by another target,
    without replacing the repaired joined view or retiring already pinned readers.

- 2c00f8b: Export localization quality findings with the selected target, culture, and check filter. Reports
  retain scan coverage, apply the target's review file, and presets replay the same selection
  through the CLI. A preset's `workspaceFilter` is accepted only in quality mode with a localization
  target. Completed quality results may report whether a rules file is attached (`ruleFile`) without
  exposing its path. Localization quality presets and exports use schema version 2, so older readers
  reject them instead of silently dropping `workspaceFilter`. Existing version-1 corpus and source
  quality investigations remain readable and retain their format when replayed.

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

- Updated dependencies [d99dcf6]
    - @ue-shed/unreal-assets@0.12.0
    - @ue-shed/localization@0.12.0

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
