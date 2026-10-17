// Named exports only. Modules not listed in an entry point are private to the package.

export { columnarTextCorpusQuery } from "./columnar-query.js";
export {
	STRING_TABLE_CLASS,
	TEXT_PROPERTY_NAME,
	TextCorpusScanError,
	TextCorpusScanOptions,
	TextCorpusService,
	TextCorpusServiceLive,
	buildTextCorpus,
	makeTextCorpusServiceTestLayer,
	scanTextCorpus,
	textCorpusFromExtractionEvents,
	textOccurrenceFromExtraction,
	textOccurrenceId,
	textOccurrencesFromInspection,
	textPackagePathsFromProjectIndex,
	type ScanTextCorpusOptions,
	type TextCorpusServiceApi,
	type TextCorpusServiceTestApi,
	type TextPackageCounts,
	type TextPackageOutcome
} from "./corpus.js";
export {
	GameTextIndexBuilder,
	typeScriptIndexBuilderLayer,
	type GameTextIndexBuildSessionRequest
} from "./index-builder.js";
export {
	indexedLocalizationJoin,
	indexedLocalizationLinesRequest,
	indexedLocalizationStatusReport,
	indexedTextCorpus,
	readIndexedLocalizationEvidence
} from "./index-context.js";
export {
	GameTextIndexError,
	GameTextIndexRefresh,
	GameTextIndexRefreshRequest,
	GameTextIndexSource,
	type GameTextIndexRefreshResult,
	type GameTextIndexSourceRequest,
	type IndexFailure
} from "./index-contract.js";
export { GameTextIndexProgress, GameTextIndexProgressReporter } from "./index-progress.js";
export { gameTextIndexRefreshLayer } from "./index-refresh.js";
export {
	makeRetainedGameTextIndex,
	makeRetainedGameTextIndexWith,
	type RetainedGameTextIndexResult
} from "./index-retained.js";
export { gameTextIndexSourceNodeLayer } from "./index-source-node.js";
export {
	GameTextIndexSteps,
	GameTextProjectRefreshRequest,
	GameTextTargetBuildRequest,
	GameTextTargetImportRequest,
	gameTextIndexStepsLayer,
	makeGameTextIndexSteps,
	type GameTextIndexModel,
	type GameTextProject,
	type GameTextProjectIndex,
	type GameTextTargetImport,
	type GameTextTargetIndex
} from "./index-steps.js";
export {
	LOCALIZATION_IMPORT_VERSION,
	LocalizationImportSource,
	importLocalizationFile,
	importLocalizationTarget,
	localizationImportMetrics,
	prepareLocalizationFile,
	type LocalizationFileImportRequest,
	type LocalizationFileSnapshotKey,
	type LocalizationImportSourceFile,
	type LocalizationTargetImportRequest
} from "./localization-import.js";
export {
	indexedLocalizationQuality,
	type IndexedLocalizationQualityOptions,
	type LocalizationQualityProgress
} from "./localization-quality-index.js";
export { type GameTextProjectView } from "./project-index-view.js";
export { TextRulesFileError, createStarterTextRules } from "./rules-file.js";
export { makeGameTextSearchWorker } from "./search-worker-node.js";
export {
	indexedSourceQuality,
	type IndexedSourceQualityOptions,
	type SourceQualityProgress
} from "./source-quality-index.js";
// Errors that appear in the public index signatures; their modules stay private.
export { SnapshotFormatError } from "./snapshot-format.js";
export { SnapshotStoreError } from "./snapshot-store.js";
