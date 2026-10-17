// Named exports only. Modules not listed in an entry point are private to the package.

export {
	MAX_CORPUS_REPORT_ITEMS,
	TextCorpusDiagnosticSummary,
	TextCorpusReport,
	TextPackageCoverageSummary,
	textCorpusDiagnosticSummary,
	textCorpusReport,
	textPackageCoverageSummary
} from "./corpus-summary.js";
export {
	gameTextCsv,
	gameTextQualityCsv,
	spreadsheetCsv,
	textAssetName,
	textQualityProblem
} from "./csv.js";
export {
	GameTextInvestigationExport,
	GameTextInvestigationPreset,
	GameTextInvestigationPresetResult,
	GameTextInvestigationQuery,
	exportGameTextInvestigation,
	gameTextInvestigationCsv
} from "./investigation.js";
export {
	LocalizationEdit,
	LocalizationEditOutcome,
	LocalizationEditRequest,
	LocalizationEditResult,
	MAX_LOCALIZATION_EDITS,
	localizationEditChangeSet,
	localizationEditOutcomes
} from "./localization-edits.js";
export {
	LocalizationLinesFileResult,
	localizationLinesCsv,
	pickedLocalizationCultures
} from "./localization-export.js";
export {
	LocalizationKeyChangePair,
	applyLocalizationKeyChanges,
	localizationKeyChanges,
	localizationKeyChangesAcross,
	manifestPlace,
	mergeLocalizationKeyChanges,
	type LocalizationKeyChanges
} from "./localization-key-changes.js";
export {
	localizationCounts,
	localizationLinePreview,
	localizationQueryPage,
	matchesLocalizationLine,
	scopedLocalizationMarks,
	validateLocalizationSelection
} from "./localization-query.js";
export {
	LocalizationBaseline,
	LocalizationBaselineDelta,
	LocalizationBaselineEntry,
	LocalizationBaselineKeyChange,
	LocalizationProgressCulture,
	LocalizationProgressReport,
	LocalizationReportError,
	createLocalizationBaseline,
	decodeLocalizationBaselineJson,
	diffLocalizationBaselines,
	localizationProgressReport
} from "./localization-reports.js";
export {
	LocalizationReviewChange,
	LocalizationReviewRequest,
	LocalizationReviewResult,
	acceptedFindingFilter,
	applyLocalizationReview,
	localizationLineFingerprint,
	matchesLocalizationReview,
	withoutAcceptedFindings
} from "./localization-review.js";
export {
	LocalizationFileProblem,
	LocalizationFileStatus,
	LocalizationStatusReport,
	explainLocalizationFile,
	localizationEvidenceFileStatuses,
	localizationEvidenceFolder,
	localizationFileProblems,
	localizationStatusReport,
	localizationTargetFiles,
	type LocalizationFileExplanation,
	type LocalizationTargetFiles
} from "./localization-status.js";
export {
	LocalizationFocus,
	LocalizationFocusRequest,
	LocalizationFocusResult,
	LocalizationTargetPreview,
	LocalizationTargetResult,
	LocalizationTargetsResult,
	LocalizationTranslation,
	localizationFocusPage
} from "./localization-view.js";
export {
	WorkspaceChangesResult,
	WorkspaceFinding,
	WorkspaceLocalizationFindingFocus,
	WorkspaceQualityFilter,
	WorkspaceQualityFocusRequest,
	WorkspaceQualityFocusResult,
	WorkspaceQualityPage,
	WorkspaceQualityReport,
	WorkspaceQualityRequest,
	WorkspaceQualityResult,
	WorkspaceReportFileRequest,
	WorkspaceReportFileResult,
	WorkspaceReportPage,
	WorkspaceReportRequest,
	WorkspaceReportResult,
	WorkspaceReportRow,
	eligibleLocalizationChange,
	localizationFindingHash,
	localizationFindingId,
	localizationQuality,
	localizationQualityWorkspace,
	localizationQualityWorkspaceOf,
	localizationReportCsv,
	localizationReportPage,
	workspaceQualityCsv,
	workspaceQualityFilterOf,
	workspaceQualityItem,
	workspaceQualitySeverity,
	type LocalizationFindingGroup,
	type LocalizationFindingList,
	type LocalizationQuality,
	type LocalizationQualityMetadata,
	type WorkspaceQualityItem
} from "./localization-workspace.js";
export {
	LocalizationGatherCoverage,
	gatheredTextIdentity,
	joinLocalizationTarget,
	localizationGatherCoverage,
	localizationGathersEditorOnlyData,
	localizationManifestNotes,
	localizationTextMatches,
	manifestPackageFile,
	matchesUnrealWildcard,
	textGatherScope
} from "./localization.js";
export {
	TextQualityFilter,
	TextQualityFindingId,
	TextQualityFindingKind,
	TextQualityFindingSummary,
	TextQualityFocus,
	TextQualityFocusRequest,
	TextQualityFocusResult,
	TextQualityQueryRunResult,
	TextQualityQuerySummary,
	TextQualityRuleFile,
	TextQualityRuleUpdateResult,
	TextQualitySearchPage,
	TextQualitySearchRequest,
	TextQualitySearchResult,
	decodeTextQualityFocusResult,
	decodeTextQualityQueryRunResult,
	decodeTextQualityRuleUpdateResult,
	decodeTextQualitySearchResult,
	makeTextQualityFindingId,
	textQualityEvidenceHash,
	textQualityFindingHash,
	textQualityFindingId,
	textQualityFindingIdHash,
	textQualityFindingIdOf,
	textQualityQuery,
	textQualityQueryOf,
	type TextQualityFindingList,
	type TextQualityQuery
} from "./quality-query.js";
export { textCorpusQuery, type TextCorpusQuery } from "./query.js";
export { hasSearchableSource, searchTextCorpus, searchableSourceText } from "./search.js";
export { RUNTIME_COPY_KINDS, hasDifferingCopy, staleRuntimeCopy } from "./text-copies.js";
export {
	textAssetFacet,
	textAudienceFacet,
	textCultureFacet,
	textFolderFacet,
	textGroupOf,
	textGroups,
	textOriginFacet
} from "./text-groups.js";
