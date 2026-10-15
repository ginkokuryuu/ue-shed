# @ue-shed/protocol

## 0.16.0

### Minor Changes

- dbb471e: Tell player text from editor text in Game Text.

    Every text occurrence now records its `audience` (`player`, `editor` or `unknown`), why
    (`audienceReason`) and the policy row that decided it (`audienceRule`). Unreal's own evidence comes
    first: uasset-io v1.11 adds `gather_editor_only` to package text record occurrences, the editor-only
    bit Unreal saved for that text in the package's gatherable text table. Otherwise the reviewed,
    studio-agnostic `TEXT_AUDIENCE_POLICY` table decides (reflection tooltips, Blueprint, animation,
    Niagara and material graph nodes, editor modules, tooltips and categories, the UMG palette
    category and Niagara script metadata are editor text; String Table entries, DataTable cells,
    Blueprint enum display names and widget designer trees are player text). Units, search results and
    localization lines roll their visible occurrences up: player if any is, else unknown if any is,
    else editor.

    Search and query requests take an `audience` filter clause, `facets.audiences` and
    `group: "audience"`; Workbench's Filter and Display menus offer them. `gameTextCsv` and
    `localizationLinesCsv` add an Audience column. With a target that does not gather editor-only data
    (`ShouldGatherFromEditorOnlyData`, false by default), editor text that would read "Not gathered
    yet" is "Outside this target" with `outOfScope: "editor_only_data_not_gathered"`, so localization
    checks skip it; lines outside the gather paths carry `outside_gather_paths`.

    The package text index format moves to `package-text-v4` and joins to `joined-v13`, so existing
    caches read their packages once more. The audience policy is part of each shard key, so later
    policy changes re-encode stored shards without reading packages again.

- 7d925d7: Fold compiled Blueprint copies into the text a Blueprint authored.

    Compiling a Blueprint saves its widget tree, animations and defaults again under the generated
    class (`WBP_X_C`, animations as `Name_INST`), its default object (`Default__WBP_X_C`) and sometimes
    a skeleton class (`SKEL_WBP_X_C`). Game Text listed each widget text twice, and a Blueprint edited
    but not compiled read as "Same key, different text".

    uasset-io v1.12 adds `blueprintClasses` to package text records: each Blueprint, the export its saved
    `GeneratedClass` names, that class's `RF_ClassDefaultObject` export, and a saved skeleton class and
    its default object. Game Text folds every copy into the occurrence at its authored site with the
    same property and key, keeping two same-key properties of one object as two places and leaving
    sites saved only under the class (such as construction-script nodes) as their own places. Nothing
    is folded from names alone, so an asset whose own name ends in `_C` is untouched.

    Each place keeps the authored text as its source and lists its copies in `copies` (`objectPath`,
    `kind`: `generated_class`, `instance`, `class_default` or `skeleton`, and `source`). Counts,
    search, facets, exports, localization joins and the index follow the places. A copy with other text
    no longer makes its key conflicting. When a copy the game runs (the generated class or class
    default) holds other text, the unit gets the `compiled_copy_differs` review signal ("Blueprint not
    compiled since edit") and the Workbench line page says what the game shows; a skeleton-only
    difference is listed but raises no signal. A place's audience rolls up over the place and its
    copies, each classified from its own gather-table bit and class, so an editor-only place with a
    runtime compiled copy stays player text.

    The package text index format moves to `package-text-v5` and joins to `joined-v14`, so existing
    caches read their packages once more.

## 0.15.0

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

### Patch Changes

- d8eca33: Upgrade Effect and its integrations to stable 4.0.4. Update renamed schema and configuration APIs,
  JSON Schema validation, synchronous cache queries, retained resource cleanup, and Remote Control
  response handling while preserving authoritative wire contracts and existing workflow behavior.
  Published libraries now require the application to provide `effect@^4.0.0` as a peer dependency,
  and `@ue-shed/observability` also requires `@effect/opentelemetry@^4.0.0`. Install these in the
  application (or reuse compatible existing versions) so UE Shed shares the application's Effect
  runtime. Workspace development and tests remain pinned to Effect 4.0.4 through the catalog.

## 0.13.0

## 0.12.0

### Minor Changes

- d90ae25: Add composable map source planning, lossless RGBA8 cropping, and linear-light parent derivation.
  Callers can choose individual tile captures or larger source blocks per zoom with explicit size
  and decoded-memory limits, while retaining control of rendering, codecs, scheduling and publication.

    Expose optional, capability-checked screenshot warmup frames on the editor-viewport renderer.
    Native screenshot warmup is separate from outer settling; the scoped override restores the original
    engine value and priority after each frame and on interruption. Extended capability discovery is
    explicitly negotiated; the original capability response remains compatible with strict v1 clients.
    Existing capture defaults remain intact.

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

- a545cd5: Keep a local Unreal editor responsive while a UE Shed host is in the foreground. The Core v1
  foreground responsiveness contract (`EditorForegroundLeaseRequest`, `EditorForegroundLeaseResult`,
  `EditorForegroundStateRequest`, `EditorForegroundStateResult`) and the manifest's
  `foregroundResponsivenessObjectPath` describe UE Shed Core's Windows-only
  `editor.foreground-responsiveness.v1` lease. `EditorForegroundResponsiveness.hold` holds a lease as a
  scoped resource: it refuses a non-loopback endpoint before sending anything, renews at a third of
  the TTL, re-acquires after a lost lease or an editor restart, degrades quietly to Unreal's normal
  policy, and releases when the scope closes. `isLoopbackEndpoint` is the shared local-only rule.
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

## 0.10.0

### Minor Changes

- 8e83f1a: Read saved Game Text from Unreal 4.27 through 5.3 packages that use legacy property tags. The native
  reader and WASM inspection decode legacy tags, containers and text histories alongside the 5.4+
  layout. Text coverage gaps add `legacy_container_element_without_type_information`,
  `feature_unavailable_for_engine_version` and `property_decoder_rejected` reasons beside
  `unsupported_text_history`; consumers that switch exhaustively on the reason should handle them.
- 5fd5bc7: Expose initialized live DataTable defaults and bounded actor/component row-reference lookup.
  Add an optional Unreal automation provider with explicit local-player input injection and owned
  CSV capture control, typed headless clients, shared contracts, and an authoring/automation source
  bundle. Existing hosts adopt the versioned UE Shed contracts without legacy native endpoints.

    Text values now carry their localization identity (snapshot 2.3, Apply 1.2): localized namespace and
    key, string-table entry, culture-invariant, or generated. Apply writes text from that identity,
    mints keys in the table package on request, and keeps identity for Apply 1.1 clients that rewrite an
    unchanged display string. Apply 1.2 refuses to remove a row whose text identity changed since
    review. Producer refusals are typed `UnrealConnectionError` codes. A new
    `editor-host` plugin bundle combines camera authoring with DataTable authoring.

## 0.9.3

No direct behavioral change. Align with the UE Shed 0.9.3 suite and exact internal dependency pins.

## 0.9.2

## 0.9.1

### Patch Changes

- ce281fb: Tell an open camera set apart from another render session. When a camera set is open in the
  editor, the renderer now refuses a session with the new `authoring_open` code, the message "A
  camera set is open in the editor." and the recovery "Close the camera set, then retry."
  `editor_busy` now means only another render session or an unrelated screenshot, and its recovery
  says to wait for that session. Failures carry the blocking issue's recovery instead of a generic
  one, including Review and map-tile captures. `isEditorOwnershipRejection` identifies both codes, and
  Review capture reports them as retry-safe view failures with the native message instead of a
  connection failure. The camera render wire adds `authoring_open` to its failure codes. Older plugins
  keep sending `editor_busy`. Packages before this release don't recognise `authoring_open` and
  report it as `render_connection_failed`, so upgrade the package with the plugin.
- ce281fb: Add opt-in `editorPreviews` to the provisioned live feed. With `editorPreviews: true`,
  `ensureProvisionedCameras` previews show the child actors that ChildActorComponents spawn for
  editor-only owners, such as spawn-volume previews, using the same rule as
  `renderer.editorPreviews` on renders. A host's live preview can then match its captures, including
  while a camera set is open and render sessions are refused with `authoring_open`.

    The plugin rescans before each batch of preview frames. It restores the original flags when the
    feed is cleared or reprovisioned without the option, when the world is cleaned up, when Play
    starts, and on shutdown. Saves never write the changed flag. Render sessions, camera panel
    previews and the feed now share one reference-counted reveal, so one of them finishing never hides
    a preview another still shows.

    The request uses provisioning version 5 only when the option is on, so other requests are
    unchanged. Status and `getCameraStatus` report `editorPreviews.revealedChildActors` while the feed
    shows previews. Older plugins ignore the option, so `ensureProvisionedCameras` fails with the new
    `ProvisionedCameraError` code `unsupported_capability`. Retry without the option to fall back. A
    missing visibility echo (version 4) now carries the same code. The provisioning contract adds
    `editorPreviews` and version 5, and `CameraStatus` adds optional `editorPreviews`. Update the plugin
    with the package to use the option.

## 0.9.0

### Minor Changes

- a3b58fd: Add opt-in `renderer.editorPreviews` to camera render policies. When true, viewport and
  SceneCapture renders show child actors that ChildActorComponents spawn for editor-only owners,
  such as spawn-volume previews, while the owners and other editor-only content stay hidden. The
  plugin restores the original editor-only flags when the session ends, fails or its world is
  cleaned up, and saves never write the changed flag. Renderers report `editorPreviews` support
  in their capabilities; frame evidence records how many child actors were shown. Older plugins
  reject the field, so the renderer reports `unsupported_capability` before opening a session.
- f69d878: Let the native camera panel reopen a saved set for its selected subject. `makeCameraSetupHost`
  accepts optional `open` and `sets` callbacks; with both, each setup poll negotiates `reopen` and
  lists the host's saved sets (`CameraSetupSavedSet`, built with `cameraSetupSavedSet`), and the host
  opens a set when the panel asks. The camera-authoring/v1 setup contract gains optional `reopen`,
  `sets`, `canOpen`, `open`, `selection.actorGuid` and the `setup_open` request. The bridge only adds
  reply fields for hosts that sent `reopen: true`, so older hosts and older plugins are unaffected.
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

## 0.8.0

### Minor Changes

- 1a60713: Add scoped camera arrangement editing, reviewed layouts and recipe import/export, a replaceable native
  Unreal menu, and atomic batch View approval. Persist effective actor hide/protect lists and produce
  Pure, Authored, or paired Review output through the shared renderer. Apply the same visibility policy
  to map-tile capture and live previews. Initial exclusions support loaded opaque non-Nanite static meshes;
  unsupported geometry and unresolved references fail explicitly. Capture requires no authoring UI.
- 8c0d895: Add verified editor-window activation through UE Shed Core and the engine library, with a Windows foreground permission handoff scoped to the connected process. Restore minimized windows and report actual activation, OS refusal, unavailable windows, and unsupported platforms.
- 64ca9bf: Inspect rich curve keys, Skeleton reference poses and bone indices, Sequencer float/double channels,
  bounded InstancedStruct values, and package/object metadata in UE 5.7 saved packages. Share the
  source-derived native layouts across native and WASM readers and preserve unsupported inner payloads.
- 33d9c5f: Add capability-negotiated asynchronous editor map opens with operation identities, bounded retained
  results and read-only completion polling. Lost acknowledgements never replay the map-open command;
  long loads remain pending and expired waits report an indeterminate outcome. Expose current editor
  map state separately, retaining compatibility with older synchronous companions.

    Workbench confirms cross-map Review Set opens, offers saved-review-only browsing, reports editor/map
    differences, and lets users explicitly follow the editor or switch it to their chosen map. Clarify
    that browsing saved camera sets only reveals drafts; selecting a draft opens it for editing.

- 23d243a: Add actor-scoped camera arrangement drafts, revision-aware durable commands and approval recovery,
  stable camera ownership in Review Set 1.4, and a replaceable Unreal RC authoring bridge. Provide
  independently optional native camera authoring bridge and reference menu plugins; saved cameras still
  capture with Core+World+Cameras only.
- 2104cb1: Add scoped editor world preparation with unloaded actor planning, actor context regions, bounded renewable leases, Data Layer ownership and explicit readiness evidence. Share native preparation with camera rendering and expose headless prepared capture and CLI recovery operations.

    Start lease renewal windows after synchronous loading, reserve cleanup capacity separately from active ownership, and preserve caller defects and interruption when restoration fails. Expose single-poll readiness as `checkReady`.

    Restore camera viewport state during UE 5.8 map teardown when the engine has already cleared the pilot lock, while preserving normal ownership checks.

- 64ca9bf: Use source-derived Unreal class and serialization models for supported saved assets. Share bounded
  native layout decoding between StringTables and enums, expose StringTable metadata in native and
  WASM inspection, and preserve saved string-table text identities.

### Patch Changes

- b0d2955: Add opt-in editor background ticking for connected live camera streams without changing editor preferences. Release the override on pause, clear, loss of world authority, disconnect, or stalled delivery. Correct round-robin iteration and prioritize the focused camera. Hosts must publish/install matching protocol, cameras, and native plugin versions.
- 2104cb1: Serialize camera approvals against their destination before committing recovery intent, honor explicitly reviewed native recovery after later host edits, and reuse equivalent capture profiles. Renew camera render leases after synchronous opening preparation.

    Allow the World preparation API through UE 5.8 Remote Control permissions. Expose the editor project root so Workbench can reject map synchronization and switching against a different project. Correlate camera workspace previews with their provisioned camera identity and preserve keyboard focus across virtualized outliner updates.

## 0.7.1

Align this package with the synchronized UE Shed 0.7.1 suite and exact internal dependency pins. There is no direct behavioral change.

## 0.7.0

### Minor Changes

- 1c03e0f: Add scoped and one-shot editor-world camera rendering with explicit viewport and SceneCapture
  policies, preparation, native ownership, restoration, progress and artifact evidence. Adopt the
  shared lifecycle in Review previews/final captures and all existing map modes. Fixed Review cameras
  no longer depend on live subject resolution. Requires the matching UEShedCore/UEShedCameras bundle
  advertising cameras.render-session.v1; existing Review documents retain their legacy policy.

## 0.6.0

### Minor Changes

- 9bd7735: Add Niagara review profiles, lit scene capture, automatic camera fitting, and matched dark/light backgrounds. Expose activity-window and poster selection helpers, material diagnostics, and a local verified video encoder while retaining saved-camera transparent capture.
- ff117a0: Add generation-bound Project Index counts through
  `countProjectIndex({ projectId, expectedGeneration, filters })`. Supply 1–16 `ProjectIndexFilter`
  values for maps, exact classes, class prefixes, class-name suffixes, or serialized names. Each
  value-based filter requires 1–64 non-empty values; empty filter lists are rejected. Overlapping
  matches count each package once. The production binary Catalog reads checked snapshot postings
  without transferring candidate headers, and the public helper validates result identity and generation.
- 2f1137a: Make Lit editor-camera tiles the default Map Capture backend, with shared exposure, disabled
  vignette, plugin-owned scene freezing, and asynchronous capture with cancellation cleanup. Add
  optional manual exposure and retain explicit legacy backends. New plans use 16-pixel gutters and
  disable fog. The default requires an unlocked rendering editor viewport and the updated camera plugin.
- 2760900: Add capture selection bounds and Lit capture readiness inspection, optional producer identity and plugin versions, actor catalog metadata, and structured Map Capture and Niagara progress. Expose library APIs and CLI workflows while retaining compatibility with producers that omit optional metadata and progress. Updated inspection operations require the advertised Core and Cameras capabilities.
- Inspect saved Blueprint graphs without launching Unreal through `readSavedBlueprint`, native IO,
  and the WASM inspection API. Return graph/node identities, saved positions, typed pins and defaults,
  canonical links, tagged node properties, and explicit coverage diagnostics. Inspection is read-only
  and limited to supported uncooked saved revisions; it does not compile or execute Blueprints.

## 0.5.1

### Patch Changes

- Define Review Capture 1.5 with exact non-nil operation UUIDs, durable Unreal actor GUID
  locators, and bounded optional locator diagnostics shared by TypeScript and Unreal.

## 0.5.0

### Patch Changes

- Align this unchanged package with the synchronized UE Shed `0.5.0` suite release. There is no
  direct behavioral change.

## 0.4.0

### Patch Changes

- Align this unchanged package with the synchronized UE Shed `0.4.0` suite release. There is no
  direct behavioral change.

## 0.3.0

### Minor Changes

- bf27d37: Version the saved-world projection to v2 with finite effective location, quaternion rotation, scale,
  and direct root-component attachment evidence. Map History schema v2 records the new actor shape and
  distinguishes attachment, effective-transform, and transform-resolution changes.

## 0.2.0

### Minor Changes

- 51c0e1b: Publish engine discovery, project launch, editor readiness, PIE, and editor-world control as the
  headless `@ue-shed/engine` library. Publish Config Explorer and Project Custodian with browser-safe
  contracts and Node service layers. Add portable Map Capture plans, editor-world previews,
  orthographic tile-pyramid capture, safe map control, and more precise JSON and provisioning
  contracts.

## 0.1.0

### Patch Changes

- 9c2cdce: Publish the stable 0.1 package set, including the headless Game Text and World Log Map History
  integration packages.
