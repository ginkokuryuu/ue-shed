---
"@ue-shed/protocol": minor
"@ue-shed/engine": minor
"@ue-shed/game-text": minor
---

Fix text keys in assets through Unreal (ADR 0011). The new, separately enabled `UEShedGameText` editor plugin changes, regenerates and adopts text keys and retypes source in DataAsset properties, Blueprint class defaults, SCS component templates and widget trees, using the editor's own id rules. It then compiles each owning Blueprint, reads every place back and saves only when asked, over Remote Control or `-run=UEShedGameText`. Requests validate every target before editing, with dry runs, typed `key_conflict`, `stale_expected` and rollback errors carrying `recovery`, `retrySafe` and `nextStep`.

- `@ue-shed/protocol`: the `ue-shed-game-text-actions` 1.0 request and result schemas (`contracts/game-text/v1`) and `gameTextObjectPath` in the capability manifest.
- `@ue-shed/engine`: Remote Control allow-lists `UEShedGameTextLibrary` when the plugin is enabled.
- `@ue-shed/game-text`: `runGameTextActions`, `gameTextActionsRequest`, `gameTextActionForOccurrence(id, occurrence, edit, packageFile)` and `verifyGameTextActions` (compare a re-read with the editor's result). Keep the scanned package file with each place so a copied package never targets its original through a saved object path.
- Compilation and rollback suppress Save on Compile. Partial-save receipts retain applied edits and generated keys, separately report package persistence, and require reconciliation rather than mutation replay. Lost mutation replies are also unsafe to retry.

Additive; no migration needed. DataTable cells keep using Authoring Apply 1.2, and graph pins are not action places yet.
