import { Schema } from "effect";

/**
 * Built-in localization checks: a line's shipped translation against its source, per culture, plus
 * translator notes and shared source text. IDs are stable: review files record them as
 * `localization.<id>`. New checks are appended.
 */
export const LocalizationCheckId = Schema.Literals([
	"format_arguments",
	"argument_modifiers",
	"rich_text",
	"po_escape_safety",
	"whitespace",
	"empty_translation",
	"missing_translator_notes",
	"duplicate_source",
	"format_argument_renamed",
	"rich_text_tags",
	"rich_text_tag_case",
	"line_breaks",
	"segment_separator",
	"length_outlier",
	"outdated_translation",
	"inconsistent_translation",
	"rich_text_tags_added",
	"source_line_endings_changed",
	"placeholder_translation"
]);
export type LocalizationCheckId = typeof LocalizationCheckId.Type;

/**
 * Built-in checks of the source text itself. They need no rule file and report once per line,
 * under the line's source culture, as `missing_translator_notes` does.
 */
export const SourceCheckId = Schema.Literals([
	"culture_invariant_text",
	"placeholder_text",
	"source_whitespace",
	"source_markup",
	"number_only_text",
	"string_table_key_collision"
]);
export type SourceCheckId = typeof SourceCheckId.Type;

/** Every built-in check: what `checks`, `disabledChecks` and `disabledLocalizationChecks` name. */
export const BuiltInCheckId = Schema.Literals([
	...LocalizationCheckId.literals,
	...SourceCheckId.literals
]);
export type BuiltInCheckId = typeof BuiltInCheckId.Type;

/**
 * How much a finding matters before the game ships. `blocking`: players see text that is wrong or
 * untranslated. `normal`: likely a bug, review it. `low`: housekeeping that rarely reaches players.
 */
export const CheckSeverity = Schema.Literals(["blocking", "normal", "low"]);
export type CheckSeverity = typeof CheckSeverity.Type;

/** Each built-in check's severity, and the rule file's budgets and terminology. */
export const checkSeverity = {
	format_arguments: "normal",
	argument_modifiers: "normal",
	rich_text: "normal",
	po_escape_safety: "normal",
	whitespace: "normal",
	empty_translation: "normal",
	missing_translator_notes: "low",
	duplicate_source: "low",
	format_argument_renamed: "normal",
	// A dropped tag loses styling or an inline image; an added one only styles more text.
	rich_text_tags: "normal",
	rich_text_tags_added: "low",
	// Slate matches style and decorator names without case, so a case change usually still renders.
	rich_text_tag_case: "low",
	line_breaks: "normal",
	segment_separator: "normal",
	length_outlier: "normal",
	// Unreal drops an archive translation whose recorded source differs: players see the source.
	outdated_translation: "blocking",
	// The recorded source differs from the current one only in CRLF against LF line endings.
	source_line_endings_changed: "low",
	inconsistent_translation: "normal",
	placeholder_translation: "normal",
	// Culture-invariant text is never gathered. Most of it is developer or data text no player
	// reads, so a finding only asks for a look.
	culture_invariant_text: "low",
	placeholder_text: "normal",
	source_whitespace: "low",
	source_markup: "normal",
	number_only_text: "low",
	string_table_key_collision: "normal",
	character_budget: "normal",
	terminology: "normal"
} as const satisfies Record<BuiltInCheckId | "character_budget" | "terminology", CheckSeverity>;
