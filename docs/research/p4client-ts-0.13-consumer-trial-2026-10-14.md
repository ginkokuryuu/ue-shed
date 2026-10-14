# p4client-ts 0.13 consumer trial

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
