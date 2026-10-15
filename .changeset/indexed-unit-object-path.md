---
"@ue-shed/game-text": patch
---

Keep Unreal's full object paths on Game Text occurrences from UE 4.27 packages. UE 4.27 usually saves
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
