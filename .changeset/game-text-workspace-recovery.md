---
"@ue-shed/game-text": minor
---

Export localization quality findings with the selected target, culture, and check filter. Reports
retain scan coverage, apply the target's review file, and presets replay the same selection
through the CLI. A preset's `workspaceFilter` is accepted only in quality mode with a localization
target. Completed quality results may report whether a rules file is attached (`ruleFile`) without
exposing its path. Localization quality presets and exports use schema version 2, so older readers
reject them instead of silently dropping `workspaceFilter`. Existing version-1 corpus and source
quality investigations remain readable and retain their format when replayed.
