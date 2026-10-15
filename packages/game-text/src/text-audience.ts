import { Schema } from "effect";
import type { LocalizationTarget } from "@ue-shed/localization/browser";
import { localizationGatherCoverage, localizationGathersEditorOnlyData } from "./localization.js";
import type { TextOccurrence } from "./schema.js";

/**
 * Who a piece of saved text is for. `player` text ships to players and needs writers and
 * localizers; `editor` text is Unreal editor text (tooltips, categories, graph nodes) or developer
 * content; `unknown` has no evidence either way.
 */
export const TextAudience = Schema.Literals(["player", "editor", "unknown"]);
export type TextAudience = typeof TextAudience.Type;

/** Why an occurrence has its audience, from the strongest evidence that applied. */
export const TextAudienceReason = Schema.Literals([
	// Unreal's saved gather table marked the site editor-only, or runtime.
	"gather_table_editor_only",
	"gather_table_runtime",
	// The fallback policy table below.
	"developer_folder",
	"editor_namespace",
	"editor_object",
	"editor_property",
	"player_asset",
	"no_evidence"
]);
export type TextAudienceReason = typeof TextAudienceReason.Type;

/** Whether a selected target's gather would collect the occurrence. */
export const TextGatherScope = Schema.Union([
	Schema.Struct({ status: Schema.Literals(["in_scope", "no_target"]) }),
	Schema.Struct({
		status: Schema.Literal("out_of_scope"),
		reason: Schema.Literals(["outside_gather_paths", "editor_only_data_not_gathered"])
	}),
	Schema.Struct({ status: Schema.Literal("unknown") })
]);
export type TextGatherScope = typeof TextGatherScope.Type;

export type TextAudienceClassification = {
	readonly audience: TextAudience;
	readonly reason: TextAudienceReason;
	/** The policy table row that matched; absent for gather-table evidence and no evidence. */
	readonly rule?: TextAudienceRuleId;
};

/**
 * A match against one part of an occurrence. Names compare case-insensitively, as Unreal's do.
 *
 * - `namespace`: the text's namespace equals `value`.
 * - `folder`: the package path starts with `value` (a mounted path such as `/Game/Developers/`).
 * - `object`: a class name or an object name in the occurrence's outer chain starts with, ends
 *   with or equals `value`. Graph objects are named after their class (`K2Node_CallFunction_3`),
 *   so one pattern covers both.
 * - `module`: the class's script module equals `value`, or ends with it when `suffix` is set.
 * - `property`: the property path's last element equals `value` (array and map suffixes ignored),
 *   or the path ends with `value` when it holds a `.`.
 * - `location`: the occurrence's location kind.
 */
export type TextAudienceMatch =
	| { readonly kind: "namespace"; readonly value: string }
	| { readonly kind: "folder"; readonly value: string }
	| {
			readonly kind: "object";
			readonly value: string;
			readonly position: "prefix" | "suffix" | "equals";
	  }
	| { readonly kind: "module"; readonly value: string; readonly suffix?: boolean }
	| { readonly kind: "property"; readonly value: string }
	| {
			readonly kind: "location";
			readonly value: "data_table_cell" | "string_table_entry";
	  };

export type TextAudienceRule = {
	readonly id: string;
	readonly audience: Exclude<TextAudience, "unknown">;
	readonly reason: Exclude<
		TextAudienceReason,
		"gather_table_editor_only" | "gather_table_runtime" | "no_evidence"
	>;
	/** Every match must hold. */
	readonly when: readonly TextAudienceMatch[];
	readonly why: string;
};

/**
 * The reviewed fallback policy, used when Unreal's gather table has no answer for an occurrence.
 * Rows apply in order; the first match wins. Editor rows come before player rows, so a K2 node
 * inside a Widget Blueprint graph stays editor text. Changes here change every project's counts:
 * document the evidence in the row's `why`, and keep `docs/products/game-text.md` in step.
 */
export const TEXT_AUDIENCE_POLICY = [
	{
		id: "developers_folder",
		audience: "editor",
		reason: "developer_folder",
		when: [{ kind: "folder", value: "/Game/Developers/" }],
		why: "Unreal's per-user developer folders; never cooked by default."
	},
	{
		id: "dev_folder",
		audience: "editor",
		reason: "developer_folder",
		when: [{ kind: "folder", value: "/Game/Dev/" }],
		why: "Conventional test and prototype content."
	},
	{
		id: "uobject_tooltips",
		audience: "editor",
		reason: "editor_namespace",
		when: [{ kind: "namespace", value: "UObjectToolTips" }],
		why: "Class and property tooltips from reflection metadata."
	},
	{
		id: "uobject_display_names",
		audience: "editor",
		reason: "editor_namespace",
		when: [{ kind: "namespace", value: "UObjectDisplayNames" }],
		why: "Class and property display names from reflection metadata."
	},
	{
		id: "uobject_categories",
		audience: "editor",
		reason: "editor_namespace",
		when: [{ kind: "namespace", value: "UObjectCategories" }],
		why: "Details panel categories from reflection metadata."
	},
	{
		id: "k2_node",
		audience: "editor",
		reason: "editor_object",
		when: [{ kind: "object", value: "K2Node_", position: "prefix" }],
		why: "Blueprint graph nodes: pin tooltips, comments, node titles."
	},
	{
		id: "anim_graph_node",
		audience: "editor",
		reason: "editor_object",
		when: [{ kind: "object", value: "AnimGraphNode_", position: "prefix" }],
		why: "Animation Blueprint graph nodes."
	},
	{
		id: "anim_state_node",
		audience: "editor",
		reason: "editor_object",
		when: [{ kind: "object", value: "AnimStateNode", position: "prefix" }],
		why: "Animation state machine graph nodes."
	},
	{
		id: "ed_graph",
		audience: "editor",
		reason: "editor_object",
		when: [{ kind: "object", value: "EdGraph", position: "prefix" }],
		why: "Editor graphs, schemas and comment nodes."
	},
	{
		id: "scs_node",
		audience: "editor",
		reason: "editor_object",
		when: [{ kind: "object", value: "SCS_Node", position: "prefix" }],
		why: "Blueprint component tree entries: categories and tooltips."
	},
	{
		id: "niagara_node",
		audience: "editor",
		reason: "editor_object",
		when: [{ kind: "object", value: "NiagaraNode", position: "prefix" }],
		why: "Niagara script graph nodes."
	},
	{
		id: "niagara_graph",
		audience: "editor",
		reason: "editor_object",
		when: [{ kind: "object", value: "NiagaraGraph", position: "prefix" }],
		why: "Niagara script graphs."
	},
	{
		id: "material_expression",
		audience: "editor",
		reason: "editor_object",
		when: [{ kind: "object", value: "MaterialExpression", position: "prefix" }],
		why: "Material graph expressions: descriptions and parameter groups."
	},
	{
		id: "material_graph",
		audience: "editor",
		reason: "editor_object",
		when: [{ kind: "object", value: "MaterialGraph", position: "prefix" }],
		why: "Material editor graphs."
	},
	{
		id: "editor_module",
		audience: "editor",
		reason: "editor_object",
		when: [{ kind: "module", value: "Editor", suffix: true }],
		why: "Classes from editor modules (`*Editor`), such as UMGEditor or NiagaraEditor."
	},
	{
		id: "unreal_ed_module",
		audience: "editor",
		reason: "editor_object",
		when: [{ kind: "module", value: "UnrealEd" }],
		why: "Classes from the UnrealEd module."
	},
	{
		id: "blueprint_graph_module",
		audience: "editor",
		reason: "editor_object",
		when: [{ kind: "module", value: "BlueprintGraph" }],
		why: "Blueprint graph classes."
	},
	{
		id: "anim_graph_module",
		audience: "editor",
		reason: "editor_object",
		when: [{ kind: "module", value: "AnimGraph" }],
		why: "Animation graph classes."
	},
	{
		id: "property_tooltip",
		audience: "editor",
		reason: "editor_property",
		when: [{ kind: "property", value: "PropertyTooltip" }],
		why: "Blueprint variable tooltips."
	},
	{
		id: "tooltip",
		audience: "editor",
		reason: "editor_property",
		when: [{ kind: "property", value: "ToolTip" }],
		why: "Editor tooltips on Blueprint functions, variables and graph pins."
	},
	{
		id: "pin_tooltip",
		audience: "editor",
		reason: "editor_property",
		when: [{ kind: "property", value: "PinToolTip" }],
		why: "Graph pin tooltips."
	},
	{
		id: "category",
		audience: "editor",
		reason: "editor_property",
		when: [{ kind: "property", value: "Category" }],
		why: "Details panel and palette categories."
	},
	{
		id: "category_name",
		audience: "editor",
		reason: "editor_property",
		when: [{ kind: "property", value: "CategoryName" }],
		why: "Blueprint and SCS category names."
	},
	{
		id: "objects_to_display_names",
		audience: "editor",
		reason: "editor_property",
		when: [{ kind: "property", value: "ObjectsToDisplayNames" }],
		why: "Editor display names for objects in a sequence or widget animation."
	},
	{
		id: "niagara_signature_description",
		audience: "editor",
		reason: "editor_property",
		when: [{ kind: "property", value: "Signature.Description" }],
		why: "Niagara function signature descriptions."
	},
	{
		id: "movie_scene_display_name",
		audience: "editor",
		reason: "editor_property",
		when: [
			{ kind: "module", value: "MovieScene" },
			{ kind: "property", value: "DisplayName" }
		],
		why: "Sequencer track names, saved as editor-only data."
	},
	{
		id: "movie_scene_tracks_display_name",
		audience: "editor",
		reason: "editor_property",
		when: [
			{ kind: "module", value: "MovieSceneTracks" },
			{ kind: "property", value: "DisplayName" }
		],
		why: "Sequencer track names, saved as editor-only data."
	},
	{
		id: "string_table",
		audience: "player",
		reason: "player_asset",
		when: [{ kind: "location", value: "string_table_entry" }],
		why: "String Table entries exist to be displayed."
	},
	{
		id: "data_table",
		audience: "player",
		reason: "player_asset",
		when: [{ kind: "location", value: "data_table_cell" }],
		why: "DataTable text cells are game data."
	},
	{
		id: "widget_tree",
		audience: "player",
		reason: "player_asset",
		when: [{ kind: "object", value: "WidgetTree", position: "equals" }],
		why: "Widgets placed in a Widget Blueprint's designer tree."
	}
] as const satisfies readonly TextAudienceRule[];

export type TextAudienceRuleId = (typeof TEXT_AUDIENCE_POLICY)[number]["id"];

/** The parts of an occurrence the policy reads, split once. */
export type TextAudienceSubject = {
	readonly namespace: string | undefined;
	readonly packagePath: string;
	readonly objects: readonly string[];
	readonly className: string | undefined;
	readonly module: string | undefined;
	readonly propertyPath: string;
	readonly locationKind: TextOccurrence["location"]["kind"];
};

const PROPERTY_SUFFIX = /(?:\[[^\]]*\]|\("[^"]*"\))+$/u;

function propertyElements(path: string): readonly string[] {
	return path
		.split(".")
		.map((element) => element.replace(PROPERTY_SUFFIX, ""))
		.filter((element) => element !== "");
}

/** Splits an Unreal object path into its package and the object names below it. */
function objectParts(objectPath: string) {
	const dot = objectPath.indexOf(".", objectPath.lastIndexOf("/") + 1);
	const packagePath = dot < 0 ? objectPath : objectPath.slice(0, dot);
	const objects =
		dot < 0
			? []
			: objectPath
					.slice(dot + 1)
					.split(/[.:]/u)
					.filter((name) => name !== "");
	return { packagePath, objects };
}

export function textAudienceSubject(occurrence: TextOccurrence): TextAudienceSubject {
	const location = occurrence.location;
	const { packagePath, objects } = objectParts(location.objectPath);
	const classPath = location.kind === "asset_property" ? location.classPath : undefined;
	const classDot = classPath?.lastIndexOf(".") ?? -1;
	const module =
		classPath?.startsWith("/Script/") && classDot > 0
			? classPath.slice("/Script/".length, classDot)
			: undefined;
	return {
		namespace:
			occurrence.identity.status === "resolved" ? occurrence.identity.namespace : undefined,
		packagePath,
		objects,
		className: classPath === undefined ? undefined : classPath.slice(classDot + 1),
		module,
		propertyPath: location.kind === "string_table_entry" ? "" : location.propertyPath,
		locationKind: location.kind
	};
}

function equalsIgnoringCase(left: string, right: string): boolean {
	return left.length === right.length && left.toLowerCase() === right.toLowerCase();
}

function nameMatches(name: string, match: Extract<TextAudienceMatch, { kind: "object" }>) {
	const lower = name.toLowerCase();
	const value = match.value.toLowerCase();
	return match.position === "prefix"
		? lower.startsWith(value)
		: match.position === "suffix"
			? lower.endsWith(value)
			: lower === value;
}

function matches(subject: TextAudienceSubject, match: TextAudienceMatch): boolean {
	switch (match.kind) {
		case "namespace":
			return (
				subject.namespace !== undefined &&
				equalsIgnoringCase(subject.namespace, match.value)
			);
		case "folder":
			return `${subject.packagePath.toLowerCase()}/`.startsWith(match.value.toLowerCase());
		case "object":
			return (
				(subject.className !== undefined && nameMatches(subject.className, match)) ||
				subject.objects.some((name) => nameMatches(name, match))
			);
		case "module":
			return (
				subject.module !== undefined &&
				(match.suffix
					? subject.module.toLowerCase().endsWith(match.value.toLowerCase())
					: equalsIgnoringCase(subject.module, match.value))
			);
		case "property": {
			const elements = propertyElements(subject.propertyPath);
			const wanted = match.value.split(".");
			if (elements.length < wanted.length) return false;
			const tail = elements.slice(elements.length - wanted.length);
			return tail.every((element, index) => equalsIgnoringCase(element, wanted[index]!));
		}
		case "location":
			return subject.locationKind === match.value;
	}
}

/** The first policy row that matches, or undefined. */
export function matchTextAudiencePolicy<const Rule extends TextAudienceRule>(
	subject: TextAudienceSubject,
	policy: readonly Rule[]
): Rule | undefined {
	return policy.find((rule) => rule.when.every((match) => matches(subject, match)));
}

export type TextAudienceEvidence = {
	/**
	 * The site's editor-only bit from the package's saved gather table, when the reader matched the
	 * occurrence to a site. Unreal itself wrote it, so it outranks the policy table.
	 */
	readonly gatherTableEditorOnly?: boolean;
};

export function classifyTextAudience(
	occurrence: TextOccurrence,
	evidence: TextAudienceEvidence = {}
): TextAudienceClassification {
	if (evidence.gatherTableEditorOnly !== undefined)
		return evidence.gatherTableEditorOnly
			? { audience: "editor", reason: "gather_table_editor_only" }
			: { audience: "player", reason: "gather_table_runtime" };
	const rule = matchTextAudiencePolicy(textAudienceSubject(occurrence), TEXT_AUDIENCE_POLICY);
	return rule
		? { audience: rule.audience, reason: rule.reason, rule: rule.id }
		: { audience: "unknown", reason: "no_evidence" };
}

/**
 * Whether the selected target's gather would collect the occurrence: its include and exclude
 * paths, then `ShouldGatherFromEditorOnlyData` for editor text. Lines that are out of scope are
 * reported as such rather than "Not gathered yet".
 */
export function textGatherScope(
	target: LocalizationTarget | undefined,
	occurrence: TextOccurrence,
	classification: TextAudienceClassification
): TextGatherScope {
	if (!target) return { status: "no_target" };
	const coverage = localizationGatherCoverage(target, occurrence);
	if (coverage.status === "outside")
		return { status: "out_of_scope", reason: "outside_gather_paths" };
	if (
		classification.audience === "editor" &&
		classification.reason !== "developer_folder" &&
		localizationGathersEditorOnlyData(target) === false
	)
		return { status: "out_of_scope", reason: "editor_only_data_not_gathered" };
	return coverage.status === "inside" ? { status: "in_scope" } : { status: "unknown" };
}

const AUDIENCE_RANK = { editor: 0, unknown: 1, player: 2 } as const satisfies Record<
	TextAudience,
	number
>;

/** A line is player text if any occurrence is; otherwise unknown if any is; otherwise editor. */
export function lineTextAudience(audiences: Iterable<TextAudience>): TextAudience {
	let best: TextAudience | undefined;
	for (const audience of audiences) {
		if (audience === "player") return audience;
		if (best === undefined || AUDIENCE_RANK[audience] > AUDIENCE_RANK[best]) best = audience;
	}
	return best ?? "unknown";
}
