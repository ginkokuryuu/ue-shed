# @ue-shed/localization

## 0.15.0

### Patch Changes

- @ue-shed/config-explorer@0.15.0
    - @ue-shed/engine@0.15.0

## 0.14.0

### Patch Changes

- d8eca33: Upgrade Effect and its integrations to stable 4.0.4. Update renamed schema and configuration APIs,
  JSON Schema validation, synchronous cache queries, retained resource cleanup, and Remote Control
  response handling while preserving authoritative wire contracts and existing workflow behavior.
  Published libraries now require the application to provide `effect@^4.0.0` as a peer dependency,
  and `@ue-shed/observability` also requires `@effect/opentelemetry@^4.0.0`. Install these in the
  application (or reuse compatible existing versions) so UE Shed shares the application's Effect
  runtime. Workspace development and tests remain pinned to Effect 4.0.4 through the catalog.
- Updated dependencies [d8eca33]
- Updated dependencies [e96a922]
    - @ue-shed/config-explorer@0.14.0
    - @ue-shed/engine@0.14.0

## 0.13.0

### Patch Changes

- @ue-shed/config-explorer@0.13.0
    - @ue-shed/engine@0.13.0

## 0.12.0

### Patch Changes

- @ue-shed/engine@0.12.0
    - @ue-shed/config-explorer@0.12.0

## 0.11.0

### Minor Changes

- 6218a5c: Change-set review treats an absent and an empty previous translation as the same: both mean no
  translation ships. A translation carried to a changed key before Unreal's gather stays current
  after the gather gives that key an empty translation.

    Add the `prepare` operation: Unreal's gather, then its PO export, in one GatherText process.

- 580442c: Share typed localization failure recovery between the event reader and streamed index importer.
  Malformed manifests, archives and PO files retain the existing recovery guidance through indexed
  CLI and Workbench workflows, with file and position details from the streaming reader.

### Patch Changes

- 982743f: Raise localization evidence and saved-reader limits tenfold, apply entry limits per file, and preserve read failure causes and recovery guidance in Game Text and the CLI.
- 580442c: Match UE 5.7 and 5.8 localization loaders by rejecting escaped unpaired UTF-16 surrogates in manifests and archives. Both the event parser and streaming index importer report the file, character offset, and typed malformed-manifest or malformed-archive failure. Saved package strings remain lossless WTF-8.
- 23c8d9c: Speed up localization file parsing and retain compact PO evidence for large targets. Byte-exact PO parsing and serialization remain available; applying translations rereads and checks the file before writing.

    Target PO evidence now exposes decoded entries in `value.entries`. Use `projectPOEvidence` to convert a full parsed document when constructing evidence; `parsePO` and `serializePO` keep their existing types and results.

- 02b5128: Match saved text carrying Unreal package namespaces to gathered localization identities, so
  translations, key changes, review fingerprints and gates use the same namespace and key as Unreal.
  Preserve full saved namespaces for asset inspection and detect shared identities and source
  conflicts across packages without false duplicate-source findings.
- 656ecf5: Import Unreal manifest, archive and PO files into Game Text snapshots by streaming, keyed by
  content hash, with a file-stat check that skips unchanged files without opening them. The PO
  parser exposes block decoding for streaming callers and takes a faster path for unescaped fields.
- Updated dependencies [a545cd5]
    - @ue-shed/engine@0.11.0
    - @ue-shed/config-explorer@0.11.0

## 0.10.0

### Minor Changes

- 8d812df: Add pure Unreal localization quality checks, provenance-bearing version-1 change-set proposals,
  and `ue-shed loc check` with optional exclusive proposal JSON creation.
- f66ac19: Plan and run Unreal localization recipes with owned process trees, bounded progress, cancellation,
  private failure logs and audited write receipts. Support UE 4.27 commandlet executable naming and
  headless CLI operation planning, including import-then-compile sync.
- bdbcaec: Add read-only Unreal localization target discovery, bounded saved-file evidence, pure format
  decoders, and byte-preserving PO serialization for Unreal 4.27, 5.7 and 5.8 layouts.
- 64976b1: Track localization review state in a project-owned review file per target. Records keep reviewed,
  proofread, approved and machine translated flags against a fingerprint of the source and the
  translation that ships next, so later edits read as changed since review. Game Text adds review
  lenses, accepted check findings and reviewed and proofread report shares.
- 271dcd1: Write reviewed translation change sets into PO files. Changes are revalidated against fresh
  evidence: the source must match the manifest, and the replaced translation must match what ships
  next. Only the edited `msgstr` values change, through an atomic, hash-guarded replace. Game Text
  adds browser-safe edit request and result schemas for hosts that stage edits.

### Patch Changes

- Updated dependencies [f66ac19]
- Updated dependencies [5fd5bc7]
    - @ue-shed/engine@0.10.0
    - @ue-shed/config-explorer@0.10.0
