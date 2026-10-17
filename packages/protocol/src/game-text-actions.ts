import { Schema } from "effect";

/**
 * `ue-shed-game-text-actions` 1.0 (ADR 0011): text identity edits the `UEShedGameText` editor
 * plugin applies through Unreal's own id rules, over Remote Control or its commandlet.
 */
export const GAME_TEXT_ACTIONS_CONTRACT = "ue-shed-game-text-actions";
export const GAME_TEXT_ACTIONS_VERSION = "1.0";
/** The most places one request may edit. */
export const GAME_TEXT_ACTIONS_MAX_ACTIONS = 256;

// UTF-16 code units, as Unreal's FString::Len counts them.
const Field = Schema.String.check(Schema.isMaxLength(4096));
const NonEmptyField = Schema.NonEmptyString.check(Schema.isMaxLength(4096));

/**
 * A text's id and source as Gather and the saved-package reader report it: the namespace leaves
 * out the package namespace Unreal adds to text inside packages.
 */
export const GameTextActionIdentity = Schema.Struct({
	namespace: Field,
	key: NonEmptyField,
	source: Field
}).annotate({ identifier: "GameTextActionIdentity" });
export type GameTextActionIdentity = typeof GameTextActionIdentity.Type;

/** An object path and the saved-package reader's property chain (`Info.Lines[2]`, `Map{0}.value`). */
export const GameTextActionPlace = Schema.Struct({
	objectPath: NonEmptyField,
	propertyPath: NonEmptyField
}).annotate({ identifier: "GameTextActionPlace" });
export type GameTextActionPlace = typeof GameTextActionPlace.Type;

export const GameTextActionEdit = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("change_key"), namespace: Field, key: NonEmptyField }),
	Schema.Struct({ kind: Schema.Literal("regenerate_key") }),
	Schema.Struct({
		kind: Schema.Literal("adopt_key"),
		namespace: Field,
		key: NonEmptyField,
		source: NonEmptyField
	}),
	Schema.Struct({ kind: Schema.Literal("change_source"), source: NonEmptyField })
]).annotate({ identifier: "GameTextActionEdit" });
export type GameTextActionEdit = typeof GameTextActionEdit.Type;

export const GameTextAction = Schema.Struct({
	id: NonEmptyField,
	place: GameTextActionPlace,
	expected: GameTextActionIdentity,
	edit: GameTextActionEdit
}).annotate({ identifier: "GameTextAction" });
export type GameTextAction = typeof GameTextAction.Type;

export const GameTextActionsRequest = Schema.Struct({
	contract: Schema.Literal(GAME_TEXT_ACTIONS_CONTRACT),
	version: Schema.Literal(GAME_TEXT_ACTIONS_VERSION),
	mode: Schema.Literals(["dry_run", "apply"]),
	/** Compile each Blueprint that owns an edited place (default true). */
	compile: Schema.optionalKey(Schema.Boolean),
	/** Save the edited packages after a successful compile (default false; needs compile). */
	save: Schema.optionalKey(Schema.Boolean),
	actions: Schema.Array(GameTextAction).check(
		Schema.isMinLength(1),
		Schema.isMaxLength(GAME_TEXT_ACTIONS_MAX_ACTIONS)
	)
}).annotate({ identifier: "GameTextActionsRequest" });
export type GameTextActionsRequest = typeof GameTextActionsRequest.Type;

export const GameTextActionErrorCode = Schema.Literals([
	"invalid_request",
	"place_not_found",
	"not_text",
	"read_only_text",
	"unsupported_place",
	"stale_expected",
	"key_conflict",
	"compile_failed",
	"not_persisted",
	"save_failed"
]);
export type GameTextActionErrorCode = typeof GameTextActionErrorCode.Type;

export const GameTextActionNextStep = Schema.Literals([
	"fix_input",
	"retry",
	"reconcile",
	"escalate"
]);
export type GameTextActionNextStep = typeof GameTextActionNextStep.Type;

export const GameTextActionError = Schema.Struct({
	code: GameTextActionErrorCode,
	actionId: Schema.optionalKey(Schema.String),
	message: Schema.String,
	recovery: Schema.String,
	retrySafe: Schema.Boolean,
	nextStep: GameTextActionNextStep
}).annotate({ identifier: "GameTextActionError" });
export type GameTextActionError = typeof GameTextActionError.Type;

/** The text after an action; a key a dry run would mint is `minted` with no value. */
export const GameTextActionOutcomeIdentity = Schema.Struct({
	namespace: Schema.String,
	key: Schema.optionalKey(Schema.String),
	minted: Schema.optionalKey(Schema.Literal(true)),
	source: Schema.String
}).annotate({ identifier: "GameTextActionOutcomeIdentity" });
export type GameTextActionOutcomeIdentity = typeof GameTextActionOutcomeIdentity.Type;

export const GameTextActionOutcome = Schema.Struct({
	id: Schema.String,
	status: Schema.Literals(["applied", "planned", "unchanged"]),
	before: GameTextActionIdentity,
	after: GameTextActionOutcomeIdentity
}).annotate({ identifier: "GameTextActionOutcome" });
export type GameTextActionOutcome = typeof GameTextActionOutcome.Type;

/**
 * `ok`: every action applied (or, in a dry run, would apply). `rejected`: nothing changed.
 * `failed`: an apply failed after editing; `rolledBack` says whether the edits were undone (a save
 * failure leaves them in the editor).
 */
export const GameTextActionsResult = Schema.Struct({
	contract: Schema.Literal(GAME_TEXT_ACTIONS_CONTRACT),
	version: Schema.Literal(GAME_TEXT_ACTIONS_VERSION),
	mode: Schema.Literals(["dry_run", "apply"]),
	status: Schema.Literals(["ok", "rejected", "failed"]),
	rolledBack: Schema.Boolean,
	actions: Schema.Array(GameTextActionOutcome),
	blueprints: Schema.Array(
		Schema.Struct({ objectPath: Schema.String, compiled: Schema.Boolean })
	),
	/** Packages the request saved, or for a dry run or unsaved apply, the packages it would write. */
	packages: Schema.Array(Schema.Struct({ packageName: Schema.String, saved: Schema.Boolean })),
	errors: Schema.Array(GameTextActionError)
}).annotate({ identifier: "GameTextActionsResult" });
export type GameTextActionsResult = typeof GameTextActionsResult.Type;

export const decodeGameTextActionsRequest = Schema.decodeUnknownEffect(GameTextActionsRequest);
export const decodeGameTextActionsResult = Schema.decodeUnknownEffect(GameTextActionsResult);
