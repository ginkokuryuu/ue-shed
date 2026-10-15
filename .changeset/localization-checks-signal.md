---
"@ue-shed/game-text": minor
---

Report source-level localization findings once per line instead of once per culture. The default
Quality list changes.

- `missing_translator_notes` and `duplicate_source` describe the source line, so each now reports
  once per line. The finding belongs to the target's native culture, or the line's first culture in
  the target by code when it has no native one. The all-cultures list counts each line once;
  selecting the native culture shows them; selecting another culture does not. Counts, rule
  summaries, search, export and focus follow, on both `checkLocalizationTarget` and the indexed
  `localizationQuality` scan. The default check set is unchanged; hosts choose checks with
  `checks`, `disabledChecks` or a rule document's `disabledLocalizationChecks`.
- Saved state still loads: presets that select either filter keep it, and review files keep their
  accepted findings. An acceptance of either check recorded under a non-native culture no longer
  matches a finding and has no effect.
