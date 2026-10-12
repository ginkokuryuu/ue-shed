import type { GameTextRuleDocument, TextQualityRuleUpdateResult } from "@ue-shed/game-text/browser";
import { createEffectAction } from "@ue-shed/ui";
import { createMemo, createSignal } from "solid-js";
import type { GameTextClientApi } from "./game-text-client.js";

export interface RuleEditorState {
	readonly draft: GameTextRuleDocument;
	readonly savedDocument?: GameTextRuleDocument | undefined;
}

type EditorFeedback =
	| { readonly status: "idle" }
	| { readonly status: "previewed" }
	| { readonly status: "saved" }
	| { readonly message: string; readonly recovery?: string; readonly status: "failed" };

/** Owned by the route so draft state and in-flight saves survive editor tab changes. */
export function createGameTextRuleState(options: {
	readonly client: GameTextClientApi;
	readonly initialState?: RuleEditorState | undefined;
	readonly onReviewed: (
		result: Extract<TextQualityRuleUpdateResult, { status: "completed" }>
	) => void;
}) {
	const action = createEffectAction();
	let baseline = options.initialState?.draft;
	const [state, setState] = createSignal(options.initialState);
	const [fileAttached, setFileAttached] = createSignal(false);
	const [busy, setBusy] = createSignal(false);
	const [feedback, setFeedback] = createSignal<EditorFeedback>({ status: "idle" });
	const dirty = createMemo(() => {
		const current = state();
		return (
			current !== undefined &&
			JSON.stringify(current.draft) !== JSON.stringify(current.savedDocument)
		);
	});
	const problems = createMemo(() => (state()?.draft ? draftProblems(state()?.draft) : []));
	const replace = (document: GameTextRuleDocument | undefined, persisted = true) => {
		action.cancel();
		baseline = document;
		setFileAttached(persisted && document !== undefined);
		setState(
			document
				? { draft: document, savedDocument: persisted ? document : undefined }
				: undefined
		);
		setBusy(false);
		setFeedback({ status: "idle" });
	};
	const changeDraft = (draft: GameTextRuleDocument) => {
		setState((current) => ({ draft, savedDocument: current?.savedDocument }));
		setFeedback({ status: "idle" });
	};
	const run = (operation: "preview" | "save", document?: GameTextRuleDocument) => {
		const submitted = document ?? state()?.draft;
		if (!submitted || busy()) return;
		const issues = draftProblems(submitted);
		if (issues.length) {
			setFeedback({
				message: issues.map((issue) => issue.message).join("\n"),
				status: "failed"
			});
			return;
		}
		setBusy(true);
		setFeedback({ status: "idle" });
		action.run(
			operation === "preview"
				? options.client.previewQualityRules(submitted)
				: options.client.saveQualityRules(submitted),
			{
				onFailure: (cause) => {
					setBusy(false);
					setFeedback({ message: String(cause), status: "failed" });
				},
				onSuccess: (result) => {
					setBusy(false);
					if (result.status === "completed") {
						setState((current) => ({
							draft:
								current?.draft === submitted
									? result.document
									: (current?.draft ?? result.document),
							savedDocument:
								operation === "save" ? result.document : current?.savedDocument
						}));
						options.onReviewed(result);
						setFeedback({ status: operation === "save" ? "saved" : "previewed" });
					} else if (result.status === "failed") {
						setFeedback({
							message: result.error.message,
							recovery: result.error.recovery,
							status: "failed"
						});
					} else {
						setFeedback({
							message: "No loaded rule file is available.",
							recovery: "Load a rule file and retry.",
							status: "failed"
						});
					}
				}
			}
		);
	};
	const upgrade = () => {
		const current = state()?.draft;
		if (!current || current.schemaVersion !== 1 || busy()) return;
		const upgraded: GameTextRuleDocument = { ...current, schemaVersion: 2 };
		changeDraft(upgraded);
		run("preview", upgraded);
	};
	const restore = (saved: RuleEditorState) => {
		setFileAttached(false);
		action.cancel();
		setState(saved);
		setBusy(false);
		setFeedback({ status: "idle" });
	};
	const discard = () => {
		const saved = state()?.savedDocument;
		const attached = fileAttached();
		replace(saved ?? baseline, attached);
	};
	return {
		state,
		fileAttached,
		busy,
		dirty,
		problems,
		feedback,
		replace,
		restore,
		discard,
		changeDraft,
		run,
		upgrade
	};
}

export type GameTextRuleState = ReturnType<typeof createGameTextRuleState>;

export interface RuleDraftProblem {
	readonly ruleId: string;
	readonly field: string;
	readonly message: string;
}
export function draftProblems(
	document: GameTextRuleDocument | undefined
): readonly RuleDraftProblem[] {
	if (!document) return [];
	const problems: RuleDraftProblem[] = [];
	const rules = [
		...document.rules,
		...(document.schemaVersion === 2 ? (document.localizationRules ?? []) : [])
	];
	for (const rule of rules) {
		const add = (field: string, message: string) =>
			problems.push({ ruleId: rule.id, field, message: `${rule.id}: ${message}` });
		if (!rule.recovery.trim())
			add("recovery", "Add recovery guidance before previewing or saving.");
		const budget = (value: number, field: string) => {
			if (!Number.isSafeInteger(value) || value < 1)
				add(field, "Use a whole-number character limit of at least 1.");
		};
		const terms = (
			entries: readonly {
				readonly kind: string;
				readonly term: string;
				readonly alternatives?: readonly string[];
			}[],
			field: string
		) => {
			if (!entries.length) add(field, "Add at least one terminology entry.");
			entries.forEach((term, index) => {
				if (!term.term.trim()) add(field, `Term ${index + 1} is empty.`);
				if (
					term.kind === "preferred" &&
					(!term.alternatives?.length ||
						term.alternatives.some((alternative) => !alternative.trim()))
				)
					add(field, `Preferred term ${index + 1} needs non-empty alternatives.`);
			});
		};
		if (rule.kind === "character_budget") budget(rule.maximumCharacters, "maximumCharacters");
		if (rule.kind === "terminology") terms(rule.terms, "terms");
		if (rule.kind === "localization_character_budget") {
			if (rule.defaultMaximumCharacters !== undefined)
				budget(rule.defaultMaximumCharacters, "defaultMaximumCharacters");
			for (const [culture, value] of Object.entries(rule.cultures)) budget(value, culture);
		}
		if (rule.kind === "localization_terminology")
			for (const [culture, entries] of Object.entries(rule.cultures)) terms(entries, culture);
	}
	return problems;
}
