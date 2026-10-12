import { Effect, Option, Schema } from "effect";
import {
	LocalizationSelection,
	LocalizationLineId,
	TextCapabilityFilter,
	TextFilter,
	TextGroupBy,
	TextReviewLens,
	TextUnitId,
	TextWhere,
	TextQualityFindingId,
	WorkspaceQualityFilter,
	GameTextRuleDocument,
	LocalizationEdit,
	TextQualityRule,
	TextTerminologyEntry,
	LocalizationProjectRule
} from "@ue-shed/game-text/browser";
import { legacyFilter } from "./game-text-filter-model.js";
import type { RuleEditorState } from "./game-text-rule-state.js";

export const GameTextEditSession = Schema.Struct({
	staged: Schema.Array(
		Schema.Struct({
			target: LocalizationSelection.fields.target,
			edit: LocalizationEdit,
			source: Schema.String
		})
	),
	drafts: Schema.Array(
		Schema.Struct({
			target: LocalizationSelection.fields.target,
			edit: LocalizationEdit,
			source: Schema.String
		})
	)
});
export type GameTextEditSession = Schema.Schema.Type<typeof GameTextEditSession>;

// Drafts validate their shape at storage boundaries while allowing incomplete authored fields.
const [Forbidden, Preferred] = TextTerminologyEntry.members;
const DraftTerm = Schema.Union([
	Forbidden.mapFields((fields) => ({ ...fields, term: Schema.String })),
	Preferred.mapFields((fields) => ({
		...fields,
		term: Schema.String,
		alternatives: Schema.Array(Schema.String)
	}))
]);
const [SourceBudget, SourceTerms] = TextQualityRule.members;
const DraftSourceRule = Schema.Union([
	SourceBudget.mapFields((fields) => ({
		...fields,
		recovery: Schema.String,
		maximumCharacters: Schema.Number
	})),
	SourceTerms.mapFields((fields) => ({
		...fields,
		recovery: Schema.String,
		terms: Schema.Array(DraftTerm)
	}))
]);
const [CultureBudget, CultureTerms] = LocalizationProjectRule.members;
const DraftLocalizationRule = Schema.Union([
	CultureBudget.mapFields((fields) => ({
		...fields,
		recovery: Schema.String,
		defaultMaximumCharacters: Schema.optionalKey(Schema.Number),
		cultures: Schema.Record(Schema.String, Schema.Number)
	})),
	CultureTerms.mapFields((fields) => ({
		...fields,
		recovery: Schema.String,
		cultures: Schema.Record(Schema.String, Schema.Array(DraftTerm))
	}))
]);
const [DocumentV1, DocumentV2] = GameTextRuleDocument.members;
const DraftDocument = Schema.Union([
	DocumentV1.mapFields((fields) => ({ ...fields, rules: Schema.Array(DraftSourceRule) })),
	DocumentV2.mapFields((fields) => ({
		...fields,
		rules: Schema.Array(DraftSourceRule),
		localizationRules: Schema.optionalKey(Schema.Array(DraftLocalizationRule))
	}))
]);

const StoredPreferences = Schema.Struct({
	localizationTarget: Schema.optionalKey(LocalizationSelection.fields.target),
	localizationCulture: LocalizationSelection.fields.culture,
	localizationCultures: LocalizationSelection.fields.cultures,
	localizationState: LocalizationSelection.fields.state,
	localizationReview: LocalizationSelection.fields.review,
	localizationKeyChanged: Schema.optionalKey(Schema.Boolean),
	searchTranslations: Schema.optionalKey(Schema.Boolean),
	selectedLocalizationId: Schema.optionalKey(LocalizationLineId),
	query: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(512))),
	capability: Schema.optionalKey(TextCapabilityFilter),
	lens: Schema.optionalKey(TextReviewLens),
	withoutNotes: Schema.optionalKey(Schema.Boolean),
	where: Schema.optionalKey(TextWhere),
	mode: Schema.optionalKey(Schema.Literals(["corpus", "quality", "reports"])),
	qualityFilter: Schema.optionalKey(WorkspaceQualityFilter),
	selectedId: Schema.optionalKey(TextUnitId),
	selectedFindingId: Schema.optionalKey(TextQualityFindingId),
	qualityDocument: Schema.optionalKey(GameTextRuleDocument),
	editSession: Schema.optionalKey(GameTextEditSession),
	qualityEditor: Schema.optionalKey(
		Schema.Struct({
			draft: DraftDocument,
			savedDocument: Schema.optionalKey(GameTextRuleDocument)
		})
	),
	filter: Schema.optionalKey(TextFilter),
	group: Schema.optionalKey(Schema.Literals([...TextGroupBy.literals, "none"]))
});

export interface GameTextPreferences {
	readonly localizationTarget?:
		| Schema.Schema.Type<typeof LocalizationSelection>["target"]
		| undefined;
	readonly localizationCulture?:
		| Schema.Schema.Type<typeof LocalizationSelection>["culture"]
		| undefined;
	/** Every picked culture; preferences saved before multi-select only have `localizationCulture`. */
	readonly localizationCultures?:
		| Schema.Schema.Type<typeof LocalizationSelection>["cultures"]
		| undefined;
	readonly localizationState?:
		| Schema.Schema.Type<typeof LocalizationSelection>["state"]
		| undefined;
	readonly localizationReview?:
		| Schema.Schema.Type<typeof LocalizationSelection>["review"]
		| undefined;
	readonly localizationKeyChanged?: boolean | undefined;
	readonly searchTranslations?: boolean | undefined;
	readonly selectedLocalizationId?: Schema.Schema.Type<typeof LocalizationLineId> | undefined;
	readonly query: string;
	readonly capability: Schema.Schema.Type<typeof TextCapabilityFilter>;
	readonly lens: Schema.Schema.Type<typeof TextReviewLens>;
	readonly withoutNotes?: boolean;
	readonly where?: Schema.Schema.Type<typeof TextWhere> | undefined;
	readonly mode?: "corpus" | "quality" | "reports";
	readonly qualityFilter?: Schema.Schema.Type<typeof WorkspaceQualityFilter>;
	readonly selectedId: Schema.Schema.Type<typeof TextUnitId> | undefined;
	readonly selectedFindingId?: Schema.Schema.Type<typeof TextQualityFindingId> | undefined;
	readonly qualityDocument?: Schema.Schema.Type<typeof GameTextRuleDocument> | undefined;
	readonly qualityEditor?: RuleEditorState | undefined;
	readonly editSession?: GameTextEditSession | undefined;
	/** Filter pills. Absent in preferences saved before pills; see `migratePreferences`. */
	readonly filter?: TextFilter | undefined;
	/** How the list groups lines; `none` lists them flat. Problem when absent. */
	readonly group?: TextGroupBy | "none" | undefined;
}

/**
 * Preferences saved before filter pills keep their toggles, lenses and state chips as fields. They
 * become pills here once; what has no pill (changed files, gathered-only and other line states)
 * stays where it was.
 */
export function migratePreferences(preferences: GameTextPreferences): GameTextPreferences {
	if (preferences.filter !== undefined) return preferences;
	const { filter, remainingState } = legacyFilter(preferences);
	const files = preferences.where?.files;
	return {
		...preferences,
		filter,
		capability: "all",
		lens: "all",
		withoutNotes: false,
		where: files === undefined ? undefined : { files },
		localizationState: remainingState,
		localizationKeyChanged: false
	};
}

/**
 * A preset's target, cultures and translation filters as the preference fields a restore reads. A
 * preset without them picks the first target and every culture, as before presets carried them.
 */
export function localizationPreferences(
	selection: Schema.Schema.Type<typeof LocalizationSelection> | undefined
) {
	return {
		localizationTarget: selection?.target,
		localizationCulture: selection?.culture,
		localizationCultures: selection?.cultures,
		localizationState: selection?.state,
		localizationReview: selection?.review,
		localizationKeyChanged: selection?.keyChanged ?? false,
		searchTranslations: selection?.searchTranslations ?? false
	} satisfies Partial<GameTextPreferences>;
}

const decodeStoredPreferences = Schema.decodeUnknownOption(
	Schema.fromJsonString(StoredPreferences)
);

export function decodeGameTextPreferences(contents: string): GameTextPreferences {
	const decoded = decodeStoredPreferences(contents.length <= 1_048_576 ? contents : "{}");
	const value: Schema.Schema.Type<typeof StoredPreferences> = Option.isSome(decoded)
		? decoded.value
		: {};
	return migratePreferences({
		...value,
		query: value.query ?? "",
		capability: value.capability ?? "all",
		lens: value.lens ?? "all",
		withoutNotes: value.withoutNotes ?? false,
		selectedId: value.selectedId
	});
}

export const readGameTextPreferences = Effect.fn("GameText.preferences.read")((key: string) =>
	Effect.try({
		try: () => {
			const contents = window.localStorage.getItem("ue-shed:game-text:" + key) ?? "{}";
			return decodeGameTextPreferences(contents);
		},
		catch: () => undefined
	}).pipe(Effect.catch(() => Effect.succeed(decodeGameTextPreferences("{}"))))
);

export const saveGameTextPreferences = Effect.fn("GameText.preferences.save")(
	(key: string, preferences: GameTextPreferences) =>
		Effect.try({
			try: () => {
				const contents = JSON.stringify(preferences);
				if (contents.length > 1_048_576) return false;
				window.localStorage.setItem("ue-shed:game-text:" + key, contents);
				return true;
			},
			catch: () => undefined
		}).pipe(Effect.catch(() => Effect.succeed(false)))
);
