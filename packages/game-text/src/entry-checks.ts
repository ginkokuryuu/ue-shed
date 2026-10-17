// Named exports only. Modules not listed in an entry point are private to the package.

export {
	checkLocalizationLine,
	checkLocalizationTarget,
	compareLocalizationFindings,
	compareReportedLocalizationFindings,
	enabledLocalizationChecks,
	invariantTextPlace,
	localizationConflictingSource,
	localizationCultureInvariantUnits,
	localizationDuplicateCandidate,
	localizationDuplicatePlaces,
	localizationDuplicateSources,
	localizationLocalizableProperties,
	localizationPropertiesWhereLocalizable,
	localizationPropertyKey,
	localizationRuleContext,
	localizationSourceCulture,
	localizationStringTables,
	localizationTranslationVariants,
	reportableInvariantText,
	type LocalizationLineCheckContext,
	type LocalizationLineCheckOutput,
	type LocalizationTranslationVariants
} from "./localization-checks.js";
export {
	DEFAULT_GATE_FAILURES,
	LocalizationGateCheck,
	LocalizationGateItem,
	LocalizationGateResult,
	LocalizationGateTarget,
	MAX_GATE_ITEMS,
	localizationGateFailures,
	localizationGateResult,
	localizationGateTarget,
	localizationGateUnreadEvidence,
	localizationGateUnreadPackages
} from "./localization-gate.js";
export {
	evaluateTextQuality,
	matchesTextRole,
	matchesTextRoleMatcher,
	prepareTextQualityRules,
	termMatches,
	textQualityUnitFindings,
	type PreparedTextQualityRule,
	type TextQualityOccurrence
} from "./quality.js";
export {
	matchesTextFilter,
	needsWork,
	textFindings,
	textProblemCounts,
	textProblems,
	translationStates,
	type TextFacts
} from "./text-problems.js";
export { unrealPluralForms } from "./unreal-plural-forms.js";
export {
	UnrealArgument,
	UnrealFormatIssue,
	UnrealFormatPattern,
	UnrealModifier,
	UnrealModifierIdentity,
	UnrealModifierName,
	UnrealRichTextCounts,
	UnrealWhitespace,
	parseUnrealFormatPattern,
	unrealRichTextCounts,
	unrealRichTextValid,
	unrealUnsafeWhitespace,
	unrealWhitespace
} from "./unreal-text-syntax.js";
