---
"@ue-shed/game-text": minor
---

Report localization problems instead of per-culture facts about the source line. The default
Quality list changes.

- `duplicate_source` and `missing_translator_notes` describe the source line, so each now reports
  once per line rather than once per culture. The finding belongs to the target's native culture,
  or the line's first culture in the target by code when it has no native one. With a culture
  selected, only that culture's line count shows them. Counts, rule summaries, search, export and
  focus follow, on both `checkLocalizationTarget` and the indexed `localizationQuality` scan.
- `missing_translator_notes` no longer runs by default: packages saved by UE 4.27 and by UE5 before
  5.8 cannot store translator notes, so it flagged every line. Opt in with
  `enabledLocalizationChecks: ["missing_translator_notes"]` in a version-1 or version-2 rule
  document, or `checks` in the options.
- Saved state still loads: presets that select either filter keep their filter (its count reads 0
  when the check does not run), and review files keep their accepted findings. An acceptance
  recorded for a non-native culture no longer matches a finding and has no effect.
