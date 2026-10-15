---
"@ue-shed/game-text": minor
---

Rate Game Text checks by severity and add translation shape, source and consistency checks.

- Every localization finding has a `severity` (`blocking`, `normal` or `low`) from
  `checkSeverity`, outside its ID. Workspace pages list blocking findings first and count findings
  by severity in `severityCounts`; summaries, focus and CSV exports carry it. Blocking:
  `outdated_translation`. Low: `duplicate_source`, `missing_translator_notes`,
  `number_only_text`, `rich_text_tag_case`, `rich_text_tags_added`, `source_line_endings_changed`,
  `source_whitespace` and `culture_invariant_text`.
- New translation checks: `format_argument_renamed` (split from `format_arguments`, which now
  reports only dropped and added arguments; the one-rename fix moves with it), `rich_text_tags`,
  `rich_text_tags_added`, `rich_text_tag_case`, `line_breaks` (split from `whitespace`, which now
  compares edges only), `segment_separator`, `length_outlier`, `placeholder_translation`,
  `outdated_translation`, `source_line_endings_changed` and `inconsistent_translation`. Shape
  checks, `format_arguments` and `argument_modifiers` included, skip empty translations, which
  `empty_translation` reports.
- New source checks that need no rule file, in `SourceCheckId`: `culture_invariant_text`,
  `placeholder_text`, `source_whitespace`, `source_markup`, `number_only_text` and
  `string_table_key_collision`. `BuiltInCheckId` names every built-in for `checks`,
  `disabledChecks`, `disabledLocalizationChecks` and `loc check --check`.
- Rule files (v1 and v2) take optional `segmentSeparator`, `optionalTags` and `optionalArguments`.
- `culture_invariant_text` reports only player text outside debug content and text render
  components, in a property that holds at least as much localizable text in the project.
- A quality workspace that lists source findings too shows a placeholder once: it leaves out a
  `placeholder_text` finding a source terminology finding already covers. The check records
  which placeholders the rule file's terminology leaves (`unreportedMatches`), so the workspace
  decides from the scan's facts without rechecking findings.
- Indexed scans build a line's units only for its findings, read translator notes and String
  Table entries from occurrence columns, and halve slow pages, so a key saved in thousands of
  places no longer stalls the scan for seconds.
- `duplicate_source` reports once per shared text and leaves out text without letters.
- Keys with conflicting saved texts list them in `sourceVariants` on findings, summaries and focus
  instead of the joined text, and are not compared or grouped by it.
- `checkLocalizationTarget` also checks a line whose saved text is blank when its manifest has the
  source, as a partly read package can leave it, so its empty archive entries are reported.
