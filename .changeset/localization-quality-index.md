---
"@ue-shed/game-text": minor
---

Check localization quality over the index instead of rebuilding the whole target as objects.

- An opened index now offers `localizationQuality(options, ruleDocument)`. It checks lines in
  bounded pages and keeps findings as columns. Pages, focus and proposals re-check only the rows
  they show.
- `localizationQualityWorkspaceOf(source, quality)` builds the same workspace over either form;
  `localizationQuality(report, join)` is the in-memory form for adapters without an index.
  `localizationQualityWorkspace(source, report, join)` is unchanged.
- `checkLocalizationLine` and the per-line policy and accepted-finding helpers expose the checks
  `checkLocalizationTarget` runs, one line at a time.
- Localization finding IDs are now a fast hash of the finding's line, culture, rule and values.
  They stay stable across rescans of unchanged text; IDs from older versions do not resolve.
