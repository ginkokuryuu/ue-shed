---
"@ue-shed/game-text": minor
---

Store each localization finding's severity. Indexed quality scans now keep a severity column beside each finding's packed facts, and groups carry their severity. Workspace ordering (`severityAt`), `severityCounts` and summaries read the severity a finding was reported with, so a rule file's per-check `severity` shows in indexed workspace pages exactly as in reports. Before, pages re-derived severity from the check's default. Version-2 and version-3 `localizationRules` accept an optional `severity` (`normal` when absent), which their findings carry.

**Breaking.** `LocalizationFindingList` requires `severity(position)` and `LocalizationFindingGroup` requires `severity`. Migration: a host that implements its own finding list should return each finding's `severity` (`finding.severity` for localization and policy findings), and give each group the severity its findings share.
