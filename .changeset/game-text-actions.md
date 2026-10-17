---
"@ue-shed/protocol": minor
"@ue-shed/engine": minor
"@ue-shed/game-text": minor
---

Fix text keys in assets through Unreal (ADR 0011). The new, separately enabled `UEShedGameText` editor plugin changes, regenerates and adopts text keys and retypes source in DataAsset properties, Blueprint class defaults, SCS component templates and widget trees, using the editor's own id rules. It then compiles each owning Blueprint, reads every place back and saves only when asked, over Remote Control or `-run=UEShedGameText`. Requests are all or nothing, with dry runs, typed `key_conflict`, `stale_expected` and rollback errors carrying `recovery`, `retrySafe` and `nextStep`.

- `@ue-shed/protocol`: the `ue-shed-game-text-actions` 1.0 request and result schemas (`contracts/game-text/v1`) and `gameTextObjectPath` in the capability manifest.
- `@ue-shed/engine`: Remote Control allow-lists `UEShedGameTextLibrary` when the plugin is enabled.
- `@ue-shed/game-text`: `runGameTextActions`, `gameTextActionsRequest`, `gameTextActionForOccurrence` and `verifyGameTextActions` (compare a re-read with the editor's result).

Additive; no migration needed. DataTable cells keep using Authoring Apply 1.2, and graph pins are not action places yet.
