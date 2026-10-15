---
"@ue-shed/game-text": minor
---

Rate Game Text checks by severity and add translation shape, source and consistency checks.

- Every localization finding has a `severity` (`blocking`, `normal` or `low`) from
  `checkSeverity`, outside its ID. Workspace pages list blocking findings first and count findings
  by severity in `severityCounts`; summaries, focus and CSV exports carry it. Blocking:
  `culture_invariant_text` and `outdated_translation`. Low: `duplicate_source`,
  `missing_translator_notes`, `number_only_text` and `rich_text_tag_case`.
- New translation checks: `format_argument_renamed` (split from `format_arguments`, which now
  reports only dropped and added arguments; the one-rename fix moves with it), `rich_text_tags`,
  `rich_text_tag_case`, `line_breaks` (split from `whitespace`, which now compares edges only),
  `segment_separator`, `length_outlier`, `outdated_translation` and `inconsistent_translation`.
- New source checks that need no rule file, in `SourceCheckId`: `culture_invariant_text`,
  `placeholder_text`, `source_whitespace`, `source_markup`, `number_only_text` and
  `string_table_key_collision`. `BuiltInCheckId` names every built-in for `checks`,
  `disabledChecks`, `disabledLocalizationChecks` and `loc check --check`.
- Rule files (v1 and v2) take an optional `segmentSeparator`.
- `duplicate_source` reports once per shared text and leaves out text without letters.
- Keys with conflicting saved texts list them in `sourceVariants` on findings, summaries and focus
  instead of the joined text, and are not compared or grouped by it.
- Empty archive entries are reported when a partly read package left the saved text blank.
