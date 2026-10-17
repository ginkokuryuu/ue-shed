---
"@ue-shed/game-text": minor
---

Ship the Game Text workspace as a library: `@ue-shed/game-text/workspace` exports `makeGameTextWorkspace(host)`. It is the scanning, search, quality-rules, localization, edit, review, report and investigation orchestration that Workbench used to keep to itself. A host supplies:

- its selected project (`project`), which the workspace reads and never changes;
- file hooks (`files`), so every rules file, report, line export and investigation file goes through the host's writable-file hook;
- `rulesRelativePath`, the rules location;
- `recoveryCopy`, which receives a rules file's previous bytes before it is overwritten;
- `localizationFiles`, the file access for PO and review writes;
- the `reviewer` and `changeAuthor` policies.

`makeGameTextOperations(host)` runs Unreal's localization steps (plan, run, cancel, changed files) for the same workspace, with hooks for the explicit engine root and progress notification.

A scan now belongs to the workspace's scope, so it keeps running when the request that started it is interrupted, and a later request for the same project generation joins it. Workbench now runs on this entry point.

The `WorkbenchOperation*` schemas and types are renamed `GameTextOperation*`. The old names remain as deprecated aliases in `/schema` and the deprecated root and `/browser` aggregates.

Migration: hosts that copied Workbench's Game Text services can replace them with `makeGameTextWorkspace`, and should switch `WorkbenchOperation*` imports to `GameTextOperation*`. The workspace exposes the latest presentation state through `progress()`; pipeline operations use `GameTextIndexProgressReporter`. Starter writes honor host-exclusive creation, and recovery reads/copies fail closed before replacing attached rules.
