// Named exports only. Modules not listed in an entry point are private to the package.

export { LocalizationWordCount, localizationWordCount } from "./localization-words.js";
export {
	GameTextRuleDocument,
	GameTextRuleDocumentError,
	GameTextSourceQualityReport,
	LocalizationProjectRule,
	TextQualityRuleDocumentV2,
	decodeGameTextRuleDocumentJson,
	evaluateGameTextSourceQuality
} from "./quality-rules-v2.js";
export { GAME_TEXT_RULES_RELATIVE_PATH, STARTER_GAME_TEXT_RULES } from "./starter-rules.js";
export {
	TEXT_AUDIENCE_MATCHER_VERSION,
	TEXT_AUDIENCE_POLICY,
	TEXT_OUT_OF_SCOPE_REASONS,
	TextGatherScope,
	classifySavedTextAudience,
	classifyTextAudience,
	decodeTextAudience,
	encodeTextAudience,
	isEditorOnlyText,
	isEditorOnlyTextCode,
	lineTextAudience,
	matchTextAudiencePolicy,
	occurrenceTextAudience,
	savedTextAudienceSubject,
	textAudienceBit,
	textAudienceFields,
	textAudienceOfMask,
	textAudienceSubject,
	type SavedTextAudienceInput,
	type TextAudienceClassification,
	type TextAudienceEvidence,
	type TextAudienceMatch,
	type TextAudienceRule,
	type TextAudienceRuleId,
	type TextAudienceSubject
} from "./text-audience.js";
export {
	TEXT_ORIGIN_KINDS,
	emptyTextOriginCounts,
	manifestFileKeys,
	manifestOrigins,
	manifestPathOrigin,
	matchesTextFiles,
	matchesTextKinds,
	matchesTextPathPrefix,
	normalizeTextPath,
	projectRelativeTextFiles,
	textFileKey,
	textFileScope,
	textFileScopeSummary,
	textLocationOrigin,
	unitFileKeys,
	unitMatchesTextWhere,
	unitOrigins,
	unitPaths,
	type TextFileScope
} from "./text-origin.js";
