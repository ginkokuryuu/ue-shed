# p4client-ts 0.13 adoption

## Status

Adopted. Map History's p4client-ts 0.13 migration from this trial was merged with main on
`feat/p4client-ts-0.13` ("Adopt p4client-ts 0.13"). Main's Effect 4.0.4 upgrade (#76)
superseded the trial's own Effect upgrade, so that merge kept main's Effect setup and only the
Map History adapter, its tests and the deleted-revision regression from this trial. Map History
depends on the published `p4client-ts@0.13.0` (npm, from p4client-ts `4985fcf`). Before it was
published, the branch was tested against a tarball packed from `bb6de90`, the same source; the two
packages differ only in the line endings of `LICENSE` and `package.json`. The sections below are
the dated trial record.

## Replacement release candidate, 2026-10-14

This section supersedes the earlier candidate's findings below. It was recorded on
`trial/p4client-ts-0.13` before main's Effect upgrade, using candidate SHA-256
`597d18003e03880587d80cd0d447ff4c74ad59e48cb6e9e899d8e9ba2d634b07`.

### What changed

- Upgrade the shared Effect catalog and its platform-node, opentelemetry and
  vitest packages from beta.98 to stable 4.0.4. The candidate's peer is now
  `^4.0.0`. Delete `.pnpmfile.cjs`; neither beta.37 nor beta.98 remains in the
  lockfile. The single-version architecture policy is unchanged.
- Replace the trial's Promise client bridge with native `P4` / `layerNode`
  composition. Commands use the host runtime and Effect interruption directly;
  separate runtimes, AbortSignals and disposal are gone. Remove the Perforce
  Promise-adapter exemption from the architecture checker. Cache only resolved
  project options, with project selection still owned by the host.
- Replace the custom Promise test factory with native P4 layers and the published
  `/testing` scripted executor. Raw lineage queries now pass the host Schema
  directly to `runTagged`; partial-failure rejection remains intentional.
- Remove the impossible-default submitted-change guard and the materialization
  metadata rejoin. Carry the submitted status and materialization input row type
  through the adapter, and project metadata directly from returned items.
- Add disposable-server regression coverage for a deleted exact revision: require
  `P4MaterializationError` / `missing_output`, preserve an existing destination,
  and leave no staging file. Existing saved-map fixture bytes are unchanged.
- Apply the host compatibility changes required by stable Effect: `TaggedError`,
  Config and CLI constructor renames, `effect/cli`, the JSON Schema conversion
  API, and explicit closeable acquisition scopes. Preserve omitted CLI booleans
  with explicit defaults and closed wire objects with `onExcessProperty: "error"`.
  Refresh generated schema artifacts for stable's flattened constraints, safe
  integer bounds and previously unrepresented array bounds; use decoded types
  for transformed wire values and Unicode regexes for exported ASCII patterns.
- Validate the complete Remote Control envelope in UE Shed instead of relying on
  unreal-rc's removed excess-property preservation option. Preserve the useful
  retired-camera refusal as a domain error. Disable cooperative scheduler yields
  only at the existing bounded synchronous Game Text query boundary; true
  asynchronous effects still cannot run there.

### Status of the ten reported library problems

| Earlier item                                   | Current status and evidence                                                                                                                                                                                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Effect peer range/import failure            | **Fixed.** Stable peer, successful native imports and one Effect version; architecture gate passes without an exception.                                                                                                                                 |
| 2. Native adoption/schema incompatibility      | **Fixed for this host after moving to stable.** The live adapter, native mock layers, interruption test and typed raw Schema all compose directly. Beta hosts remain outside the supported peer contract, as documented.                                 |
| 3. Missing type/result migration map           | **Fixed.** MIGRATION.md now maps old exported types, status-specific pages, snapshot results and existing ISO timestamp fields.                                                                                                                          |
| 4. Error construction/category migration       | **Fixed.** The guide has an object-constructor example, complete categories and reason-based distinctions. Missing named users/clients can be `not_found`; they are not all configuration failures.                                                      |
| 5. Lost materialization metadata type          | **Fixed.** Generic input/result types retain the full supplied row; the consumer metadata join is removed and the projection test passes.                                                                                                                |
| 6. Deleted revision false success              | **Fixed, verified on a real server.** Exact deleted revision 2 fails with `missing_output`, preserves prior output and cleans staging. Normal history and its CLI journey also pass.                                                                     |
| 7. Missing usable consumer test/replay example | **Fixed.** The testing guide includes service mocks, strict replay and a complete Promise replay recipe; `/testing` is packed. Native scripted executor and P4 test layers work in the consumer. The guide uses Bun, but our Vitest consumer also works. |
| 8. Missing project-scoped discovery recipe     | **Fixed in documentation.** Getting Started now gives resolution, explicit connection, user filtering, workspace matching and isolated derivation. App-owned project selection remains necessary by design.                                              |
| 9. Raw tagged partial failures not called out  | **Fixed in documentation.** The migration guide explicitly documents raw `failures` and auditing both items and failures. The consumer continues to reject incomplete lineage/mapping evidence.                                                          |
| 10. Submitted changelist narrowing             | **Fixed.** Literal submitted status yields numeric changes in service, Promise, runner and watched declarations; the adapter no longer guards against `default`.                                                                                         |

The documentation assessment used the supplied MIGRATION.md and the local
library's `packages/www/src/content/docs/guides/getting-started.mdx` and
`testing-and-fixtures.mdx`. No upstream files were modified.

### New findings and remaining feedback

No new p4client-ts defect was reproduced in the consumer's exercised acquisition
paths. Moving this host from beta.98 to stable is a repository-wide migration,
not a drop-in dependency edit: constructor/export renames, schema artifact
changes, CLI boolean defaults and cooperative scheduling all require attention.
An adjacent unreal-rc consumer also depended on the removed Schema
`onExcessProperty: "preserve"` behavior and dropped the companion's `ResultJson`.
UE Shed now decodes that envelope itself; unreal-rc should update its open
response schema for stable Effect rather than depend on that removed option.

The Perforce harness's committed Windows downloader hashes still do not match
current r26.1 downloads. This is the existing UE Shed harness issue, not a
p4client-ts regression. Explicit matching 2026.1 binaries still work. Keep
materialization's documented nontransactional batch behavior and Promise-client
ownership guidance: they are product contracts, not outstanding defects.

The candidate remains a local file dependency. A fresh install needs that
machine-local tarball; this trial branch is not publishable until it uses a
published release. The stable runtime requirement and migration cost are the
remaining adoption feedback. The earlier library blockers are resolved.

### Follow-up verification

Final commands used Node 26.5.0 and pnpm 11.17.0. The shell's default Node was
24.21.0, so checks explicitly prepended the discovered Node 26 installation.

- `pnpm install --frozen-lockfile`: passed with the replacement tarball's new
  integrity. `pnpm --filter @ue-shed/map-history why effect` reports only 4.0.4.
  The obsolete local beta.37 directory was also removed after checking that it
  was an unredirected directory inside this workspace's pnpm store.
- `pnpm check:precommit`: passed after the final source changes: formatting, lint,
  repository-wide builds/typecheck, StyleX, 43 architecture tests and contracts.
  Lint still prints warnings, with no errors. Formatting and contract checks
  were rerun after ordering generated JSON keys for review.
- `pnpm effect:architecture`: passed after the final adapter edits, without
  relaxing version policy or retaining the Perforce Promise exemption.
- `pnpm exec vitest run packages/map-history/src`: 86 passed; four real-server
  tests skipped here and exercised separately below.
- `pnpm test:perforce-map-history`, with the explicit matching 2026.1 binaries
  from the earlier trial: four real-server tests passed, including the new
  deleted-revision/output-preservation case, plus the CLI child-process journey.
  Final suite duration was 3.70 s. The disposable server was removed normally.
- Focused Perforce, Remote Control, HTTP texture-preview, camera-arrangement and
  Review CLI coverage: 118 passed, with five opt-in tests skipped. The real
  Perforce and native Unreal lanes ran separately.
- The reproduced Game Text scheduler case (seed 22) plus the eight existing
  persisted differential cases: all nine passed after the final rebuild.
- `pnpm license:check`: passed. `pnpm test:release`: 49 passed.
- `pnpm test:uasset-wasm`: passed: 23 inspection fixtures, 12 authoring fixtures,
  eight compact projection fixtures, Blueprint/Level Sequence coverage and typed
  failure/limit checks. No Rust parser or codegen implementation changed.
- UE 5.7: `pnpm test:unreal-plugins out/p4-trial-ue57` passed, all 11 plugins built
  and 35 producer tests passed.
- UE 5.8: `pnpm test:unreal-plugins out/p4-trial-ue58` passed, all 11 plugins built
  and 35 producer tests passed. Each invocation used its discovered/verified
  engine root explicitly. Evidence remains under those output directories.
- `git diff --check`: passed. No saved Unreal fixture bytes, C++ sources or
  engine API calls were changed. The saved-asset engine matrix was not rerun;
  the relevant producer checks above ran on both required engine versions.

**The broad test suite is not green.** `pnpm test` recorded 2,502 passed,
38 failed, 52 skipped and two file-handle garbage-collection errors during a
parallel run before the final scheduler/camera fixes, alongside Unreal builds.
A bounded rerun of its failing files still had 14 failures before the final
scheduler rebuild. These are real recorded failures, not a passing portable gate.

After rebuilding, the final one-worker rerun of Game Text index steps,
localization-status CLI integration and scale tests passed 36 of 37 tests. The
index-step and localization-status suites passed. The remaining scale test is
`rejects a cached edit as a fresh PO measurement and restores the source bytes`:
its `benchmark-localization-import.ts --mode shared --select cold --po-change-byte 110`
child exits unsuccessfully. This reproduces in isolation and is still unresolved;
it has not been attributed to p4client-ts or compared against the earlier Effect
baseline. Broader timeout/file-handle findings also need a clean complete rerun
before claiming the portable gate. No timeout limits or tests were disabled.

What still does not work: the default pinned Windows Perforce downloader, that
isolated scale benchmark test, and a fully verified broad portable gate. The
local tarball also prevents publishing this branch as-is. No outstanding defect
from the ten original p4client-ts feedback items remains reproduced. Remaining
feedback is the stable-host migration cost, unreal-rc's removed excess-property
assumption, and the separate scale/cleanup investigation above.

## Earlier candidate: historical record

Everything below describes the superseded tarball, including its private beta.37
hook and failed architecture gate; those statements are not the current state.
Local branch: `trial/p4client-ts-0.13`. Candidate: the supplied
`p4client-ts-0.13.0.tgz`, installed as a file dependency. This is a consumer trial,
not a publishable release dependency. No upstream library files were changed.

## Consumer changes

- Replace `P4Client` / `createP4Service` with the `/promise` facade. UE Shed keeps
  Effect beta.98; the candidate receives a private beta.37 through `.pnpmfile.cjs`.
  The hook converts this candidate's Effect peer into an exact dependency.
- Scope each command's Promise runtime with `Effect.acquireRelease`, forward
  interruption through `signal`, and dispose discovery probes in `finally`.
  Cache resolved project configuration, rather than owned runtimes.
- Keep the headless domain's existing filters and results stable. Translate to
  `listChangelists({ status: "submitted", cursor })`, `file` / `limit` snapshot
  inputs, ISO `createdAt`, `change`, and `fileSpec` materialization inputs.
- Resolve local connection settings separately from server information, select the
  project-bound workspace, and use explicit connection fields for commands.
- Use typed `whereFiles` mappings; reject exclusions, overlapping rows, and item
  failures. Adapt guarded `runTagged` for the existing bounded direct-move query,
  validate returned rows with UE Shed's own Schema, and reject partial failures.
- Rejoin materialization metadata by depot path and revision; derive counts from
  result items. Update error classification for the new `configuration` category.
- Replace obsolete brand casts in tests with the library's validated constructors.
  Cover pagination, exact snapshot bounds, metadata retention, exclusions, and
  command interruption/disposal.
- Correct an already stale World Partition integration assertion: the final two
  fixture edits are now classified as transform changes by the current saved-world
  projection. A comparison using main's original adapter and p4client-ts 0.12.1
  returned exactly the same changes and no unclassified packages. No parser or
  fixture bytes were changed to make the test pass.

## Library feedback

1. **Blocking Effect peer range.** The manifest advertises
   `effect: ^4.0.0-beta.37`, so pnpm accepts the host's beta.98, but importing either
   `/node` or `/promise` then throws:
   `SyntaxError: The requested module 'effect' does not provide an export named 'ServiceMap'`.
   Pin the actually supported beta, or support the newer API. A Promise-only
   consumer should have an obvious way to isolate the library runtime. A plain
   package-specific override did not isolate the peer; the trial's manifest hook
   adds an exact beta.37 dependency and removes the Effect peer. This is the largest
   migration obstacle and remains required. The repository
   `effect:architecture` gate still rejects the mixed versions; fixing the upstream
   compatibility is necessary before this trial can satisfy the full portable gate.
2. **Effect-native adoption is blocked for this host.** The rewritten native service
   and test executor layers use beta.37's `ServiceMap`, while UE Shed uses beta.98's
   `Context`. We could not retain direct service composition without downgrading the
   whole application. The Promise facade is a workable boundary, but introduces
   independently owned runtimes, abort signals, and explicit disposal. The migration
   guide should show this mixed-version consumer case and its supported limits.
   Likewise, UE Shed's beta.98 schemas should not be passed into the candidate's
   beta.37 `runTagged`; this adapter decodes raw items on its own side instead.
3. **The migration table lacks a type/result map.** It names new methods but does not
   say that `ListSubmittedChangelistsOptions/Result` become `ListChangelistsOptions`
   and `P4ChangelistPage`, or that snapshot results become
   `P4DepotFileRevisionList`. `createdAtIso` also disappears: `createdAt` now carries
   the ISO value. The broad timestamp note describes Unix-second changes and does
   not clearly explain this existing ISO consumer. These required inspecting the
   packed declarations, rather than following the table alone.
4. **Error migration needs a complete example and category map.** The old positional
   `P4CommandError(message, result, category)` constructor becomes an object with
   `reason`, `category`, `command`, `args`, `exitCode`, `messages`, and `stderr`.
   The guide describes fields but gives no construction example. Old categories
   `server_config`, `client`, `user`, and `charset` collapse into `configuration`,
   with detail on `reason`. Without reading declarations, an existing error mapper
   silently loses its configuration recovery guidance.
5. **Materialization drops useful metadata from its declared output.** Its `.file`
   type now contains only `depotFile` and `revision`, even when input originated from
   a complete depot snapshot. The implementation currently returns the input object,
   including extra fields, but the public type does not promise those fields.
   We explicitly rejoin action, submitted change, and file type by the composite
   revision key. Document this change or preserve caller metadata generically.
6. **Confirmed materialization false success for deleted revisions.** Against a real
   disposable server, asking for a deleted external actor's exact revision returned
   one item, no messages, and a `localPath` that did not exist. The declaration
   comment warns about this, but the migration guide's statement that materialize
   fails for missing files/revisions does not explain the distinction. A reported
   materialized item should represent an existing output, or return a typed failure.
   UE Shed filters delete actions before materialization, so normal history remains
   usable; the library gap remains.
7. **The removed executor callback makes small consumer tests more involved.** The
   supported replacement requires building a library-version Effect executor layer
   and supplying a derivation function to `createP4ClientFromLayer`. In this mixed
   Effect host that seam is especially awkward. The migration guide has no complete
   replay/test example. We added a narrow consumer client-factory seam to test
   configuration and lifecycle without crossing incompatible Effect layers.
8. **Configuration discovery is now a multi-step recipe.** `getEnvironment` no longer
   resolves local settings, its `port` is null for an environment-configured port,
   and default workspace listing now returns every user's clients. Correct project
   binding requires `resolveConnection({ sources: ["p4"] })`, server info, an explicit
   user filter, client selection, and connection overrides. The individual changes
   are documented, but a complete project-scoped recipe would prevent easy mistakes.
9. **Partial failures require auditing every acquisition path.** `whereFiles` and raw
   tagged calls can return items alongside `failures`; consuming just items can
   turn incomplete evidence into apparent success. The new model is useful, but the
   operation table should explicitly call out raw `runTagged` item failures too.
   Our mapping and lineage paths reject partial failures.

10. **Submitted results lose useful type narrowing.** Even with `status: "submitted"`,
    `P4ChangelistPage.items[].change` is `number | "default"`; the old submitted
    result guaranteed a number. The adapter now needs an impossible-default guard
    before exposing numeric domain changelists. A status-specific overload or
    discriminated row type would preserve that guarantee.

## Verification and remaining limits

The real conformance lane passed all three tests and the CLI child-process journey
with matching `P4/NTX64/2026.1/3089746` and `P4D/NTX64/2026.1/3089746` binaries.
Commands used the harness's explicit binary configuration and an isolated localhost
server; they did not use a contributor server or mutate a contributor workspace.

The default downloader remains unusable on this machine because its committed
Windows r26.1 hashes no longer match the current Perforce distribution. We left
those pins unchanged and used explicit binaries. Downloaded SHA-256 values:

- p4.exe: `f7962fec744cfc809f53338a19ebc9bb718bf76fb349a9eb0229f301f4b202a3`
- p4d.exe: `eee7ac13927872282bcb3e4b037af960f2ec0905a1e6747cb343e77ac1e7091d`

An initial P4 2025.2 / P4D 2026.1 pair caused roughly 15-second multi-spec requests
and exceeded the existing five-second test timeout. The raw CLI reproduced the
same delay; this was not a library regression. Matching 2026.1 binaries pass with
the original timeout. No timeout-policy changes were retained.

The local tarball must remain available at the manifest's configured path for a
fresh install. The private Effect compatibility hook is repository-local and is
not carried into a published consumer manifest. This branch must not be published
as-is. Native Effect composition and deleted-revision materialization remain
upstream limitations. The Effect architecture gate still rejects the two installed Effect versions; its
version policy has not been relaxed for this trial. The Perforce file is registered
as an explicit Promise adapter, but that does not waive the version guard.
The complete portable CI gate and Unreal editor checks were
not part of this dependency trial; existing saved fixture bytes were used.

Final checks used Node 26.11.1:

- `pnpm install --frozen-lockfile`: passed.
- `pnpm check:precommit`: passed, including repository-wide typecheck, formatting,
  lint, StyleX checks, 43 architecture tests, and contract checks.
- `pnpm exec vitest run packages/map-history/src`: 86 passed; the three opt-in
  real-server tests are skipped in this ordinary run and run separately below.
- `pnpm test:perforce-map-history` with explicit matching binaries: all three
  real-server tests passed, plus the CLI journey; the final test run took 3.16 s.
- `pnpm test:architecture`, Perforce dependency boundary, license boundary, and
  `git diff --check`: passed. Lint has existing warnings outside the changed code.
- `pnpm effect:architecture`: fails solely on the two Effect versions. This is a
  material trial limitation, not a waived check or a fully verified portable gate.

No Unreal editor checks were run on UE 5.7 or UE 5.8. This migration changes no
Unreal APIs, parser/codegen implementation, plugin code, or fixture package bytes;
the Perforce conformance lane reads the existing saved fixture through the native
reader. The comparison with the original adapter also used that same reader.
