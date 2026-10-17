---
"@ue-shed/game-text": minor
---

Let a rule file define its own localization checks. Version-3 rule files take up to 512 `customChecks`, reported beside the built-in checks with the same evidence, review marks and workspace model:

- `pattern`: a regular expression the text matches, or does not match
- `length`: a minimum or maximum, in visible or code-point characters
- `forbidden_term`: terms matched as the terminology rules match them

Each check runs on the source or on each translation and has its own label, severity, recovery text and scope (cultures, roles, object path prefixes). Findings are the new `LocalizationCustomFinding` (`kind: "custom"`). Reports list the checks in `customChecks` and count them in `rules`.

The workspace filter list is no longer closed:

- `WorkspaceQualityFilter` accepts `custom.<id>` (`customQualityFilter`) beside `BuiltInQualityFilter`.
- Pages list the file's checks in `customFilters` and count them under `counts["custom.<id>"]`.
- `workspaceQualityLabel(filter, labels)` names them, and the Workbench quality view shows them as filters.

Indexed scans store each finding's rule in its own column and pack the filter into 19 bits, which lifts the 8,192-rule and 64-filter limits of the packed facts.

**Breaking.**

- `WorkspaceQualityFilter` is now a union, so it has no `.literals`; use `BuiltInQualityFilter.literals`.
- `LocalizationQualityReport.findings` and the workspace `Finding` union gain `LocalizationCustomFinding`.
- `WorkspaceQualityPage` requires `customFilters`.
- `LocalizationCheckScope` and `localizationCheckInScope` moved to `localization-check-scope.ts`, so deep imports must follow. Package-root exports are unchanged.
- Code that switches exhaustively on finding `kind` must handle `"custom"`.

Migration: replace `WorkspaceQualityFilter.literals` with `BuiltInQualityFilter.literals`, and add the page's `customFilters` where filters are listed. Handle `kind: "custom"` where findings are rendered: `label`, `actual.text` and `actual.matches` describe the finding.
