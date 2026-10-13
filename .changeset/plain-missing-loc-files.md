---
"@ue-shed/game-text": minor
---

Tell missing localization files apart from unreadable ones. A manifest, archive or PO file the
working copy does not have now reads "Not in this working copy: <path>" with a Gather or Export
recovery, while files that exist but fail to read keep "could not be read" with their error code.
Ready `LocalizationTargetResult` values gain optional `fileProblems` and `localizationFolder`;
`WorkspaceReportPage` gains optional `gatherFilesMissing`, `gatherFileProblems` and
`localizationFolder`. New exports: `LocalizationFileProblem`, `localizationFileProblems`,
`explainLocalizationFile`, `localizationEvidenceFolder` and `localizationTargetFiles`.
`localizationManifestFailure` accepts the manifest's relative path. The generic missing-evidence
labels no longer claim a read failure.
