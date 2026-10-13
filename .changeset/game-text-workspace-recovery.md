---
"@ue-shed/game-text": minor
---

Export localization quality findings with the selected target, culture, and check filter. Reports
retain scan coverage, apply the target's review file, and presets replay the same selection
through the CLI. A preset's `workspaceFilter` is accepted only in quality mode with a localization
target. Completed quality results may report whether a rules file is attached (`ruleFile`) without
exposing its path. Older `@ue-shed/game-text` readers cannot decode the new `localization_quality`
export result or presets that carry `workspaceFilter`.
