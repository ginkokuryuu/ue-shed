import * as stylex from "@stylexjs/stylex";
import {
	textLocationLabel,
	textCountLabel,
	textReviewSignalLabel,
	type GameTextInvestigationPreset,
	type TextCorpusFocus,
	type TextCorpusQueryRunResult,
	type TextCorpusQuerySummary,
	type TextCorpusSearchPage,
	type TextCorpusSearchRequest,
	type TextOccurrence,
	type TextQualityFindingId,
	type TextQualityFilter,
	type TextQualityQueryRunResult,
	type TextQualityQuerySummary,
	type GameTextRuleDocument,
	type TextQualityRuleUpdateResult,
	type TextFilter,
	type TextGroupBy,
	type TextUnitId,
	type LocalizationState,
	LocalizationReviewLens
} from "@ue-shed/game-text/browser";
import {
	Button,
	Chip,
	ToolButton,
	ToolIcon,
	createEffectAction,
	createEffectSubscription
} from "@ue-shed/ui";
import { InvestigationActions } from "@ue-shed/ui/investigation-actions";
import type { TaskProgress } from "@ue-shed/ui/task-progress";
import { Effect, Schedule, Stream } from "effect";
import { For, Show, createEffect, createMemo, createSignal, onSettled, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { GameTextClientApi } from "./game-text-client.js";
import { GameTextScanProgress } from "./game-text-scan-progress.js";
import { CopyButton } from "./game-text-copy-button.js";
import { ShowInUnrealButton } from "./game-text-locate-button.js";
import { ReadProblems, CoverageNotes } from "./game-text-read-problems.js";
import { GameTextQualityWorkspace } from "./game-text-quality-workspace.js";
import { GameTextLocalizationQuality } from "./game-text-localization-quality.js";
import { GameTextReports } from "./game-text-reports.js";
import { createGameTextRuleState } from "./game-text-rule-state.js";
import {
	localizationPreferences,
	migratePreferences,
	readGameTextPreferences,
	saveGameTextPreferences,
	type GameTextPreferences
} from "./game-text-preferences.js";
import { clauseParts } from "./game-text-filter-model.js";
import { DisplayMenu } from "./game-text-display-menu.js";
import { FacetsPane } from "./game-text-facets.js";
import { FolderBrowser } from "./game-text-folder-browser.js";
import { LinePageHeader, LineProblem, LineProperties } from "./game-text-line-page.js";
import {
	FilterMenu,
	FilterPills,
	type ExtraField,
	type FilterCounts
} from "./game-text-filter-menu.js";
import { BulkBar, createLineSelection } from "./game-text-bulk-bar.js";
import { GroupedResults, type GroupLoaded, type LoadedRow } from "./game-text-grouped-results.js";
import { reviewLensLabel } from "./game-text-review.js";
import { createGameTextLocalizationState } from "./game-text-localization-state.js";
import {
	createGameTextEdits,
	StagedEditsButton,
	StagedEditsPanel
} from "./game-text-translation-edits.js";
import {
	LocalizationControls,
	TranslationsDetail,
	GatheredDetail,
	localizationLabels
} from "./game-text-localization-view.js";
import { GameTextColumns, GameTextResultRows } from "./game-text-result-rows.js";
import { BrowseSummary, browseStyles } from "./game-text-browse-chrome.js";
import {
	createGameTextOperations,
	OperationPanel,
	SyncWithUnreal,
	UnrealSteps
} from "./game-text-operations.js";
import { identityLabel, locationDetail, sourceText } from "./game-text-view.js";
import { styles } from "./game-text-styles.js";
import { WhereFilter, textWhere } from "./game-text-where.js";

export { CopyButton } from "./game-text-copy-button.js";
export type { GameTextPreferences } from "./game-text-preferences.js";

const localizationProblems = new Set([
	"key_changed",
	"not_gathered",
	"changed_since_gather",
	"translation"
]);

/** Line states that are facts rather than problems; they filter through the selection. */
const LINE_FACT_STATES: readonly LocalizationState[] = [
	"gathered_only",
	"not_found",
	"outside_target",
	"unknown"
];

function scanTime(value: string | undefined): string {
	if (!value) return "";
	const date = new Date(value);
	if (!Number.isFinite(date.getTime())) return "";
	const today = date.toDateString() === new Date().toDateString();
	return (
		(today ? "" : date.toLocaleDateString() + " ") +
		date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
	);
}

function elapsedTime(seconds: number): string {
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function focusStats(focus: TextCorpusFocus): string {
	return textCountLabel(focus.totalOccurrences, "location");
}

export function GameTextRoute(props: {
	readonly client: GameTextClientApi;
	readonly initialPreferences?: GameTextPreferences | undefined;
	readonly onPreferencesChange?: (preferences: GameTextPreferences) => void;
	readonly projectKey?: string | undefined;
	readonly onOpenDataAuthoring?: (objectPath: string) => void;
}) {
	const initial = untrack(() => {
		const preferences = props.initialPreferences;
		return preferences === undefined ? undefined : migratePreferences(preferences);
	});
	const [query, setQuery] = createSignal(initial?.query ?? "");
	// Saved toggles and lenses became filter pills; these keep their defaults in requests.
	const [capability, setCapability] = createSignal(initial?.capability ?? "all");
	const [lens, setLens] = createSignal(initial?.lens ?? "all");
	const [withoutNotes, setWithoutNotes] = createSignal(initial?.withoutNotes ?? false);
	const [where, setWhere] = createSignal(initial?.where);
	const [filter, setFilter] = createSignal<TextFilter>(initial?.filter ?? []);
	const [group, setGroup] = createSignal<TextGroupBy | "none">(initial?.group ?? "problem");
	const [facetFolder, setFacetFolder] = createSignal("");
	const [mode, setMode] = createSignal<"corpus" | "quality" | "reports">(
		initial?.mode ?? "corpus"
	);
	const [qualityFilter, setQualityFilter] = createSignal(initial?.qualityFilter ?? "all");
	const [selectedId, setSelectedId] = createSignal<TextUnitId | undefined>(initial?.selectedId);
	const [selectedFindingId, setSelectedFindingId] = createSignal<
		TextQualityFindingId | undefined
	>(initial?.selectedFindingId);
	const [scanRevision, setScanRevision] = createSignal(0);
	const [summary, setSummary] = createSignal<TextCorpusQuerySummary>();
	const [page, setPage] = createSignal<TextCorpusSearchPage>();
	const [committedRequest, setCommittedRequest] = createSignal<TextCorpusSearchRequest>();
	const [focus, setFocus] = createSignal<TextCorpusFocus>();
	const [searching, setSearching] = createSignal(true);
	const [queryMs, setQueryMs] = createSignal<number>();
	const [loading, setLoading] = createSignal(true);
	const [projectAvailable, setProjectAvailable] = createSignal(true);
	const [preparing, setPreparing] = createSignal(true);
	const [elapsedSeconds, setElapsedSeconds] = createSignal(0);
	const [preparationSeconds, setPreparationSeconds] = createSignal<number>();
	const [persistenceFailed, setPersistenceFailed] = createSignal(false);
	const [memoryReady, setMemoryReady] = createSignal(false);
	const [projectKey, setProjectKey] = createSignal(untrack(() => props.projectKey));
	const [error, setError] = createSignal<string>();
	const [retryError, setRetryError] = createSignal<() => void>();
	const [searchFailed, setSearchFailed] = createSignal(false);
	const showError = (message: string, retry: () => void, search = false) => {
		setError(message);
		setRetryError(() => retry);
		setSearchFailed(search);
	};
	const [scanNotice, setScanNotice] = createSignal<string>();
	const [qualityFailure, setQualityFailure] =
		createSignal<Extract<TextQualityQueryRunResult, { status: "failed" }>["error"]>();
	const [workspaceFindingCount, setWorkspaceFindingCount] = createSignal<number>();
	const workspaceCountAction = createEffectAction();
	const sourceFilter = (): TextQualityFilter =>
		qualityFilter() === "character_budget"
			? "character_budget"
			: qualityFilter() === "terminology"
				? "terminology"
				: "all";
	const [qualitySummary, setQualitySummary] = createSignal<TextQualityQuerySummary>();
	const qualityTabCount = () =>
		localization.target() && props.client.localizationQualitySearch
			? workspaceFindingCount()
			: qualitySummary()?.findingCount;
	const [qualityDocument, setQualityDocument] = createSignal<GameTextRuleDocument | undefined>(
		initial?.qualityDocument
	);
	const [progress, setProgress] = createSignal<TaskProgress>({
		completed: 0,
		total: 0,
		phase: "idle",
		stage: "game_text"
	});
	const searchAction = createEffectAction();
	const focusAction = createEffectAction();
	const refreshAction = createEffectAction();
	const qualityAction = createEffectAction();
	const memoryAction = createEffectAction();
	const persistAction = createEffectAction();
	const progressSubscription = createEffectSubscription();
	const elapsedSubscription = createEffectSubscription();
	let searchGeneration = 0;
	let focusGeneration = 0;
	const localization = createGameTextLocalizationState({
		client: props.client,
		initial,
		summary,
		selectedUnit: selectedId,
		onPending: () => {
			setPreparing(true);
		}
	});
	const indexBusy = () =>
		loading() || Boolean(summary() && preparing() && !localization.error() && !error());
	const progressLabel = () =>
		!loading() && localization.ready()
			? "Loading first results"
			: (progress().detail ??
				(progress().stage === "project_index"
					? "Discovering saved packages"
					: progress().phase === "scanning"
						? "Inspecting text-bearing packages"
						: !loading()
							? "Loading translations"
							: "Preparing saved text index"));
	let observingProgress = false;
	let preparationStarted = 0;
	createEffect(indexBusy, (busy) => {
		if (busy === observingProgress) return;
		observingProgress = busy;
		if (!busy) {
			progressSubscription.cancel();
			elapsedSubscription.cancel();
			if (untrack(() => page() && !error() && !localization.error())) {
				setPreparationSeconds(Math.floor((performance.now() - preparationStarted) / 1000));
			}
			return;
		}
		const started = performance.now();
		preparationStarted = started;
		setElapsedSeconds(0);
		progressSubscription.subscribe(
			Stream.fromEffectSchedule(props.client.progress(), Schedule.spaced("250 millis")),
			{ onValue: setProgress }
		);
		elapsedSubscription.subscribe(
			Stream.fromEffectSchedule(
				Effect.sync(() => Math.floor((performance.now() - started) / 1000)),
				Schedule.spaced("1 second")
			),
			{ onValue: setElapsedSeconds }
		);
	});
	const progressTotal = () => (!loading() && localization.ready() ? 0 : progress().total);
	const operations = createGameTextOperations({
		client: props.client,
		target: localization.target,
		scanning: loading,
		revision: summary,
		onCompleted: () => load(false)
	});
	const edits = createGameTextEdits({
		client: props.client,
		target: localization.target,
		nativeCulture: () => localization.active()?.target.nativeCulture ?? undefined,
		busy: () => loading() || operations.busy(),
		onWritten: () => load(false),
		initial: initial?.editSession
	});
	const editor = createGameTextRuleState({
		client: props.client,
		initialState:
			initial?.qualityEditor ??
			(initial?.qualityDocument
				? {
						draft: initial.qualityDocument,
						savedDocument: initial.qualityDocument
					}
				: undefined),
		onReviewed: (result) => {
			setQualityFailure(undefined);
			setQualityDocument(result.document);
			setQualitySummary(result.summary);
		}
	});

	const requestFocus = (id: TextUnitId, cursor?: TextCorpusFocus["nextOccurrenceCursor"]) => {
		const generation = ++focusGeneration;
		const target = localization.target();
		const line = localization.selectedId();
		focusAction.run(
			props.client.focus({
				id,
				...(target && line ? { localization: { target, id: line } } : undefined),
				pageSize: 50,
				...(cursor ? { occurrenceCursor: cursor } : undefined)
			}),
			{
				onFailure: (cause) => {
					if (generation === focusGeneration)
						showError(String(cause), () => requestFocus(id, cursor));
				},
				onSuccess: (result) => {
					if (generation !== focusGeneration) return;
					if (result.status === "found") {
						setFocus((previous) =>
							cursor && previous?.unit.id === id
								? {
										...result.focus,
										occurrences: [
											...previous.occurrences,
											...result.focus.occurrences
										]
									}
								: result.focus
						);
					} else {
						setFocus(undefined);
						if (result.status === "not_found") setSelectedId(undefined);
					}
				}
			}
		);
	};

	const whereField = () => {
		const value = where();
		return value === undefined ? undefined : { where: value };
	};
	const groupField = () => {
		const value = group();
		return value === "none" ? undefined : { group: value };
	};
	const localizationField = () => {
		const selected = localization.selection();
		return selected === undefined ? undefined : { localization: selected };
	};
	// A picked line opens its page. Its place and neighbours come from the rows each group reports,
	// or the flat page's rows, so the page follows grouping, open groups and loaded pages.
	let resultsSection: HTMLElement | undefined;
	let searchInput: HTMLInputElement | undefined;
	let linePane: HTMLElement | undefined;
	let returnRow: HTMLElement | undefined;
	const [paneCollapsed, setPaneCollapsed] = createSignal(false);
	const collapsed = () => paneCollapsed() && !lineOpen();
	const lineOpen = () => selectedId() !== undefined || localization.selectedId() !== undefined;
	const [groupRows, setGroupRows] = createSignal<ReadonlyMap<string, readonly LoadedRow[]>>(
		new Map()
	);
	// A line only in the gather has no unit, so a closed page (no unit either) must not match it.
	const isOpenLine = (row: LoadedRow) => {
		const line = localization.selectedId();
		if (line !== undefined) return row.line === line;
		const unit = selectedId();
		return unit !== undefined && row.unit === unit;
	};
	const flatRows = (): readonly LoadedRow[] => {
		const current = page();
		if (!current) return [];
		if (!current.localization)
			return current.units.map((unit) => ({ unit: unit.id, line: undefined }));
		const units = new Set(current.units.map((unit) => unit.id));
		return current.localization.lines.map((line) => ({
			line: line.id,
			unit:
				line.origin.kind === "corpus"
					? line.origin.unitIds.find((id) => units.has(id))
					: undefined
		}));
	};
	// Where the open line is: its group (if grouped) and its place in that group's loaded rows.
	const openLineAt = () => {
		const groups = page()?.groups?.entries;
		if (!groups) {
			const rows = flatRows();
			const index = rows.findIndex(isOpenLine);
			return index < 0 ? undefined : { group: -1, rows, index, before: 0 };
		}
		let before = 0;
		for (const [group, entry] of groups.entries()) {
			const rows = groupRows().get(entry.key) ?? [];
			const index = rows.findIndex(isOpenLine);
			if (index >= 0) return { group, rows, index, before };
			before += entry.count;
		}
		return undefined;
	};
	const linePosition = () => {
		const total = page()?.total;
		const at = openLineAt();
		return total === undefined || at === undefined
			? undefined
			: { index: at.before + at.index, total };
	};
	// A step that has to open a group or load its next page finishes when that group reports its
	// rows: the row to pick is the first, the last, or a place in the group. A step lands only while
	// the line it started from is still open, so going back to the list or opening another line
	// cancels it.
	let pendingStep:
		| {
				readonly group: string;
				readonly pick: "first" | "last" | number;
				readonly from: LoadedRow;
		  }
		| undefined;
	const selectRow = (row: LoadedRow | undefined) => {
		if (row === undefined) return;
		if (
			document.activeElement instanceof HTMLElement &&
			document.activeElement.hasAttribute("data-row")
		)
			returnRow = document.activeElement;
		setPaneCollapsed(false);
		setSelectedId(row.unit);
		localization.setSelectedId(row.line);
	};
	const stillOpen = (from: LoadedRow) => untrack(() => isOpenLine(from));
	// Each open group's next-page loader, while it has more pages.
	const groupMore = new Map<string, () => void>();
	const groupLoaded: GroupLoaded = (group, rows, more) => {
		setGroupRows((current) => new Map(current).set(group, rows));
		if (more === undefined) groupMore.delete(group);
		else groupMore.set(group, more);
		const step = pendingStep;
		if (step === undefined || step.group !== group) return;
		if (!stillOpen(step.from)) {
			pendingStep = undefined;
			return;
		}
		// A group's last line is its last matching line, so its pages load until none are left.
		if (step.pick === "last" && more !== undefined) {
			more();
			return;
		}
		pendingStep = undefined;
		selectRow(
			step.pick === "first" ? rows[0] : step.pick === "last" ? rows.at(-1) : rows[step.pick]
		);
	};
	// Without groups, a step past the loaded rows loads the next page and picks this row.
	let pendingFlat: { readonly index: number; readonly from: LoadedRow } | undefined;
	createEffect(flatRows, (rows) => {
		const step = pendingFlat;
		if (step === undefined || rows.length <= step.index) return;
		pendingFlat = undefined;
		if (stillOpen(step.from)) selectRow(rows[step.index]);
	});
	// Opening a closed group goes through its header, as a click would.
	const groupControl = (key: string, selector: string) =>
		Array.from(resultsSection?.querySelectorAll<HTMLElement>("section[data-group]") ?? [])
			.find((section) => section.dataset.group === key)
			?.querySelector<HTMLButtonElement>(selector);
	const moveLine = (step: -1 | 1) => {
		const at = openLineAt();
		const from = at?.rows[at.index];
		if (at === undefined || from === undefined) return;
		const next = at.rows[at.index + step];
		if (next !== undefined) {
			selectRow(next);
			return;
		}
		const groups = page()?.groups?.entries;
		if (!groups) {
			const current = page();
			if (step === 1 && (current?.localization?.nextCursor ?? current?.nextCursor)) {
				pendingFlat = { index: at.index + 1, from };
				moreResults();
			}
			return;
		}
		const entry = groups[at.group];
		if (!entry) return;
		// The group's next page, when there is one.
		const more = step === 1 ? groupMore.get(entry.key) : undefined;
		if (more) {
			pendingStep = { group: entry.key, pick: at.index + 1, from };
			more();
			return;
		}
		// The neighbouring group, opened if it is closed.
		const neighbour = groups[at.group + step];
		if (!neighbour) return;
		const header = groupControl(neighbour.key, 'button[aria-expanded="false"]');
		const rest = step === -1 ? groupMore.get(neighbour.key) : undefined;
		if (header || rest) {
			pendingStep = { group: neighbour.key, pick: step === 1 ? "first" : "last", from };
			if (header) header.click();
			else rest?.();
			return;
		}
		const loaded = groupRows().get(neighbour.key) ?? [];
		selectRow(step === 1 ? loaded[0] : loaded.at(-1));
	};
	// Lines ticked for bulk actions, in the list's order for shift-click ranges. A new target
	// starts a new selection.
	const selection = createLineSelection({
		order: () => {
			const groups = page()?.groups?.entries;
			if (!groups) return page()?.localization?.lines ?? [];
			return groups.flatMap((entry) =>
				(groupRows().get(entry.key) ?? []).flatMap((row) =>
					row.preview === undefined ? [] : [row.preview]
				)
			);
		}
	});
	createEffect(
		() => localization.target(),
		() => selection.clear()
	);
	const ticks = () =>
		localization.active()
			? {
					checked: selection.isTicked,
					onCheck: selection.toggle,
					checking: selection.ticked().size > 0
				}
			: undefined;
	createEffect(lineOpen, (open) => {
		if (open)
			queueMicrotask(() =>
				linePane?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true })
			);
	});
	createEffect(
		() => ({
			unit: selectedId(),
			line: localization.selectedId()
		}),
		() => {
			queueMicrotask(() =>
				resultsSection
					?.querySelector<HTMLElement>('[data-row][aria-current="true"]')
					?.scrollIntoView?.({ block: "nearest" })
			);
		}
	);
	const [focusBack, setFocusBack] = createSignal<LoadedRow>();
	createEffect(
		() => ({ wanted: focusBack(), page: page(), groups: groupRows() }),
		({ wanted }) => {
			if (!wanted) return;
			queueMicrotask(() => {
				const row = Array.from(
					resultsSection?.querySelectorAll<HTMLElement>("[data-row]") ?? []
				).find((element) =>
					wanted.line
						? element.dataset.line === wanted.line
						: element.dataset.unit === wanted.unit
				);
				if (row) {
					row.focus({ preventScroll: true });
					setFocusBack(undefined);
				}
			});
		}
	);
	const closeLine = () => {
		setFocusBack({ unit: selectedId(), line: localization.selectedId() });
		const row =
			resultsSection?.querySelector<HTMLElement>('[data-row][aria-current="true"]') ??
			returnRow;
		pendingFlat = undefined;
		pendingStep = undefined;
		setSelectedId(undefined);
		localization.setSelectedId(undefined);
		queueMicrotask(() => {
			if (row?.isConnected) row.focus({ preventScroll: true });
			else searchInput?.focus();
		});
	};
	// Review state and line facts still filter through the selection, one choice at a time.
	const extraFields = (): readonly ExtraField[] => {
		if (!localization.active()) return [];
		const current = searching() ? undefined : page()?.localization;
		const review = current?.reviewCounts;
		return [
			...(review === undefined && !localization.review()
				? []
				: [
						{
							key: "review",
							label: "Review",
							options: LocalizationReviewLens.literals.map((lens) => ({
								label: reviewLensLabel(lens),
								count: review?.[lens],
								selected: localization.review() === lens,
								onSelect: () =>
									localization.setReview(
										localization.review() === lens ? undefined : lens
									)
							}))
						}
					]),
			{
				key: "line",
				label: "Line state",
				options: LINE_FACT_STATES.map((state) => ({
					label: localizationLabels[state],
					count: current?.stateCounts[state],
					selected: localization.state() === state,
					onSelect: () =>
						localization.setState(localization.state() === state ? undefined : state)
				}))
			}
		];
	};
	// The Filter menu counts each value from the current page, while no search is running.
	const filterCounts = (): FilterCounts => {
		const current = searching() ? undefined : page();
		if (current === undefined) return { choices: {}, folders: undefined, assets: undefined };
		const states = current.localization?.stateCounts;
		const counts = current.counts;
		return {
			choices: {
				...(current.problems === undefined ? undefined : { problem: current.problems }),
				...(states === undefined
					? undefined
					: {
							translation: {
								missing: states.not_translated,
								to_update: states.needs_update,
								not_synced: states.not_synced
							}
						}),
				finding: {
					shared: counts.shared,
					duplicate_source: counts.duplicate_source,
					long: counts.long,
					unresolved: counts.unresolved
				},
				origin: counts.origins,
				editing: { editable: counts.editable, read_only: counts.readOnly },
				notes: {
					missing: counts.withoutNotes,
					present: Math.max(0, current.total - counts.withoutNotes)
				}
			},
			folders: current.facets?.folders,
			assets: current.facets?.assets
		};
	};
	const searchRequest = createMemo((): TextCorpusSearchRequest => {
		const selected = localization.selection();
		const clauses = selected
			? filter()
			: filter().flatMap((clause): TextFilter => {
					if (clause.field === "translation") return [];
					if (clause.field !== "problem") return [clause];
					const values = clause.values.filter(
						(value) => !localizationProblems.has(value)
					);
					return values.length ? [{ ...clause, values }] : [];
				});
		return {
			query: query(),
			capability: capability(),
			lens: lens(),
			withoutNotes: withoutNotes(),
			...whereField(),
			...(clauses.length > 0 ? { filter: clauses } : undefined),
			...groupField(),
			facets: {
				folder: facetFolder(),
				assets: true,
				origins: true,
				...(selected ? { cultures: true } : undefined)
			},
			...(selected ? { localization: selected } : undefined),
			pageSize: 50
		};
	});
	const narrowing = createMemo(
		() =>
			[
				query() ? `“${query()}”` : undefined,
				...filter().map((clause) => {
					const parts = clauseParts(clause);
					return `${parts.field} ${parts.op} ${parts.values}`;
				}),
				localization.state()
					? localizationLabels[localization.state() ?? "unknown"]
					: undefined,
				localization.review()
					? reviewLensLabel(localization.review() ?? "reviewed")
					: undefined,
				where()?.files ? "changed files" : undefined,
				localization.cultures().length
					? "cultures " + localization.cultures().join(", ")
					: undefined
			]
				.filter((item) => item !== undefined)
				.join("; ") || "the scanned text"
	);
	const moreResults = () => {
		const current = untrack(page);
		const request = committedRequest() ?? searchRequest();
		if (current?.localization?.nextCursor)
			requestPage({ ...request, localizationCursor: current.localization.nextCursor });
		else if (current?.nextCursor) requestPage({ ...request, cursor: current.nextCursor });
	};
	let previousSearch = "";
	const requestPage = (request: TextCorpusSearchRequest, debounce = false) => {
		const generation = ++searchGeneration;
		const {
			cursor: _cursor,
			localizationCursor: _localizationCursor,
			...baseRequest
		} = request;
		const signature = JSON.stringify(baseRequest);
		const desired =
			signature === previousSearch
				? untrack(() => page()?.localization?.lines.length ?? page()?.units.length ?? 50)
				: 50;
		previousSearch = signature;
		let started = 0;
		// A new search replaces the rows a pending step was counting on.
		if (!request.cursor && !request.localizationCursor) {
			pendingFlat = undefined;
			pendingStep = undefined;
		}
		setError(undefined);
		setSearchFailed(false);
		setSearching(true);
		searchAction.run(
			(debounce ? Effect.sleep("120 millis") : Effect.void).pipe(
				Effect.flatMap(() => {
					started = performance.now();
					return Effect.gen(function* () {
						let result = yield* props.client.search(request);
						if (
							result.status !== "ready" ||
							request.cursor ||
							request.localizationCursor
						)
							return result;
						let collected = result.page;
						while (
							(collected.localization?.lines.length ?? collected.units.length) <
							desired
						) {
							const cursor =
								collected.localization?.nextCursor ?? collected.nextCursor;
							if (!cursor) break;
							result = yield* props.client.search({
								...request,
								...(collected.localization?.nextCursor
									? { localizationCursor: collected.localization.nextCursor }
									: { cursor: collected.nextCursor })
							});
							if (result.status !== "ready") return result;
							collected = {
								...result.page,
								units: [...collected.units, ...result.page.units],
								...(collected.localization && result.page.localization
									? {
											localization: {
												...result.page.localization,
												lines: [
													...collected.localization.lines,
													...result.page.localization.lines
												]
											}
										}
									: undefined)
							};
						}
						return { status: "ready" as const, page: collected };
					});
				})
			),
			{
				onFailure: (cause) => {
					if (generation === searchGeneration) {
						if (!untrack(loading)) setPreparing(false);
						setSearching(false);
						showError(String(cause), () => requestPage(request), true);
					}
				},
				onSuccess: (result) => {
					if (generation !== searchGeneration) return;
					if (!untrack(loading)) setPreparing(false);
					if (result.status === "ready") {
						setCommittedRequest(baseRequest);
						setQueryMs(performance.now() - started);
						setPage((previous) =>
							(request.cursor || request.localizationCursor) && previous
								? {
										...result.page,
										units: [...previous.units, ...result.page.units],
										...(result.page.localization && previous.localization
											? {
													localization: {
														...result.page.localization,
														lines: [
															...previous.localization.lines,
															...result.page.localization.lines
														]
													}
												}
											: undefined)
									}
								: result.page
						);
						setSearching(false);
					} else {
						setSearching(false);
						showError(
							"The saved assets changed. Rescan the project to search again.",
							() => load(true)
						);
					}
				}
			}
		);
	};

	const applyQuality = (result: TextQualityQueryRunResult | TextQualityRuleUpdateResult) => {
		if (result.status === "completed") {
			setQualityFailure(undefined);
			setQualityDocument(result.document);
			setQualitySummary(result.summary);
			editor.replace(result.document);
		} else if (result.status === "failed") setQualityFailure(result.error);
	};

	const load = (refresh: boolean) => {
		setPreparing(true);
		setLoading(true);
		setError(undefined);
		setSearchFailed(false);
		setScanNotice(undefined);
		setProgress({ completed: 0, total: 0, phase: "idle", stage: "game_text" });
		refreshAction.run(props.client.loadConfiguredProject(refresh), {
			onFailure: (cause) => {
				setPreparing(false);
				setLoading(false);
				showError(String(cause), () => load(refresh));
			},
			onSuccess: (result: TextCorpusQueryRunResult) => {
				setLoading(false);
				setProjectAvailable(result.status !== "not_configured");
				if (result.status === "completed") {
					localization.load();
					setSummary(result.summary);
					setScanRevision((revision) => revision + 1);
					if (!untrack(projectKey) && props.client.projectKey) {
						memoryAction.run(props.client.projectKey(), {
							onSuccess: setProjectKey
						});
					}
				} else if (result.status === "failed") {
					setPreparing(false);
					showError(result.error.message + " " + result.error.recovery, () =>
						load(refresh)
					);
				} else if (result.status === "cancelled") {
					setPreparing(false);
					setScanNotice("Scan cancelled. Your workspace project selection is unchanged.");
				} else setPreparing(false);
			}
		});
	};

	const restore = (saved: GameTextPreferences) => {
		const preferences = migratePreferences(saved);
		focusGeneration++;
		setFocus(undefined);
		setQualitySummary(undefined);
		setQualityFailure(undefined);
		localization.restore(preferences);
		if (preferences.editSession) edits.restore(preferences.editSession);
		setQuery(preferences.query);
		setCapability(preferences.capability);
		setLens(preferences.lens);
		setWithoutNotes(preferences.withoutNotes ?? false);
		setWhere(preferences.where);
		setFilter(preferences.filter ?? []);
		setGroup(preferences.group ?? "problem");
		setMode(preferences.mode ?? "corpus");
		setQualityFilter(preferences.qualityFilter ?? "all");
		setSelectedId(preferences.selectedId);
		setSelectedFindingId(preferences.selectedFindingId);
		setQualityDocument(preferences.qualityDocument);
		editor.replace(preferences.qualityDocument, false);
		if (preferences.qualityEditor) editor.restore(preferences.qualityEditor);
	};

	// Requests consume committed state, including preferences restored during the first load.
	createEffect(
		() => ({
			summary: summary(),
			revision: scanRevision(),
			request: searchRequest(),
			ready: localization.ready()
		}),
		({ summary: current, request, ready }) => {
			if (current && ready) requestPage(request, true);
		}
	);
	createEffect(
		() => ({
			summary: summary(),
			id: selectedId(),
			line: localization.selectedId(),
			target: localization.target(),
			ready: localization.ready()
		}),
		({ summary: current, id }) => {
			if (current && id) requestFocus(id);
			else {
				focusGeneration++;
				focusAction.cancel();
				setFocus(undefined);
			}
		}
	);
	createEffect(
		() => ({ summary: summary(), document: qualityDocument() }),
		({ summary: current, document }) => {
			if (!current || !document) return;
			qualityAction.run(props.client.previewQualityRules(document), {
				onSuccess: (reviewed) => {
					if (reviewed.status === "completed") {
						setQualityFailure(undefined);
						setQualitySummary(reviewed.summary);
					} else applyQuality(reviewed);
				},
				onFailure: (cause) =>
					showError(String(cause), () => editor.run("preview", document))
			});
		}
	);

	createEffect(
		() => ({
			ready: memoryReady(),
			key: projectKey(),
			preferences: {
				query: query(),
				capability: capability(),
				lens: lens(),
				withoutNotes: withoutNotes(),
				// A changed-file list lasts for the session; pills and grouping are saved.
				where: textWhere(where()?.kinds, where()?.pathPrefix),
				filter: filter(),
				group: group(),
				mode: mode(),
				qualityFilter: qualityFilter(),
				selectedId: selectedId(),
				selectedFindingId: selectedFindingId(),
				qualityDocument: qualityDocument(),
				qualityEditor: editor.state(),
				editSession: edits.session(),
				localizationTarget: localization.target(),
				localizationCulture: localization.culture(),
				localizationCultures:
					localization.cultures().length > 0 ? localization.cultures() : undefined,
				localizationState: localization.state(),
				localizationReview: localization.review(),
				localizationKeyChanged: localization.keyChanged(),
				searchTranslations: localization.searchTranslations(),
				selectedLocalizationId: localization.selectedId()
			}
		}),
		({ ready, key, preferences }) => {
			if (!ready) return;
			props.onPreferencesChange?.(preferences);
			if (key)
				persistAction.run(saveGameTextPreferences(key, preferences), {
					onSuccess: (saved) => setPersistenceFailed(!saved)
				});
		}
	);

	onSettled(() => {
		const shortcut = (event: KeyboardEvent) => {
			if (
				mode() === "corpus" &&
				lineOpen() &&
				!event.defaultPrevented &&
				!(
					event.target instanceof Element &&
					event.target.closest('[role="dialog"], [role="alertdialog"]')
				)
			) {
				if (event.key === "Escape") {
					event.preventDefault();
					closeLine();
				}
				if (event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
					event.preventDefault();
					moveLine(event.key === "ArrowDown" ? 1 : -1);
				}
			}
			if (
				mode() === "corpus" &&
				(event.ctrlKey || event.metaKey) &&
				event.key.toLowerCase() === "k"
			) {
				event.preventDefault();
				searchInput?.focus({ preventScroll: true });
				searchInput?.select();
			}
		};
		const beforeUnload = (event: BeforeUnloadEvent) => {
			if (editor.dirty() || edits.hasDrafts()) {
				event.preventDefault();
				event.returnValue = "";
			}
		};
		window.addEventListener("beforeunload", beforeUnload);
		window.addEventListener("keydown", shortcut);
		return () => {
			window.removeEventListener("keydown", shortcut);
			window.removeEventListener("beforeunload", beforeUnload);
		};
	});
	onSettled(() => {
		memoryAction.run(
			Effect.gen(function* () {
				const key =
					props.projectKey ??
					(props.client.projectKey ? yield* props.client.projectKey() : undefined);
				const preferences = key ? yield* readGameTextPreferences(key) : undefined;
				return { key, preferences };
			}),
			{
				onSuccess: ({ key, preferences }) => {
					setProjectKey(key);
					if (!initial && preferences) restore(preferences);
					setMemoryReady(true);
					load(false);
				},
				onFailure: () => {
					setMemoryReady(true);
					load(false);
				}
			}
		);
	});

	const [replacement, setReplacement] = createSignal<() => void>();
	const guardRules = (next: () => void) => {
		if (editor.dirty()) setReplacement(() => next);
		else next();
	};
	const loadRules = (create?: boolean) =>
		guardRules(() => {
			setQualityFailure(undefined);
			const operation =
				create === undefined
					? props.client.chooseQualityRules()
					: props.client.createStarterRules?.(create);
			if (!operation) return;
			qualityAction.run(operation, {
				onSuccess: applyQuality,
				onFailure: (cause) => showError(String(cause), () => loadRules(create))
			});
		});
	const reloadRules = () =>
		guardRules(() => {
			setQualityFailure(undefined);
			qualityAction.run(
				props.client.reloadQualityRules?.() ?? props.client.chooseQualityRules(),
				{
					onSuccess: applyQuality,
					onFailure: (cause) => showError(String(cause), reloadRules)
				}
			);
		});
	const restorePreset = (preset: GameTextInvestigationPreset) => {
		const { localization: selected, ...saved } = preset.query;
		restore({
			...saved,
			qualityFilter: saved.workspaceFilter ?? saved.qualityFilter,
			...localizationPreferences(selected),
			withoutNotes: saved.withoutNotes ?? false,
			lens: saved.lens ?? "all",
			selectedId: undefined,
			qualityDocument: preset.rules
		});
		load(false);
	};
	createEffect(
		() => ({
			mode: mode(),
			active: localization.active(),
			culture: localization.culture(),
			document: qualityDocument(),
			summary: qualitySummary()
		}),
		({ mode: currentMode, active, culture }) => {
			workspaceCountAction.cancel();
			setWorkspaceFindingCount(undefined);
			if (currentMode !== "quality" || !active || !props.client.localizationQualitySearch)
				return;
			workspaceCountAction.run(
				props.client.localizationQualitySearch({
					target: active.target.name,
					filter: "all",
					...(culture ? { culture } : undefined)
				}),
				{
					onSuccess: (result) => {
						if (result.status === "ready") setWorkspaceFindingCount(result.page.total);
					}
				}
			);
		}
	);
	createEffect(
		() => ({ ready: localization.ready(), active: localization.active(), mode: mode() }),
		(state) => {
			if (state.ready && !state.active && state.mode === "reports") setMode("corpus");
		}
	);
	// One spreadsheet with every language for the lines the list shows.
	const allLanguagesExport = () => {
		const request = props.client.localizationLinesFile;
		if (!request) return Effect.succeed({ status: "cancelled" as const });
		return request(searchRequest()).pipe(
			Effect.map((result) =>
				result.status === "not_ready"
					? {
							status: "failed" as const,
							message: "Translations are still loading.",
							recovery: "Try again in a moment."
						}
					: result
			)
		);
	};
	const exports = (): JSX.Element => (
		<Show when={props.client.investigations}>
			{(client) => (
				<div {...stylex.attrs(styles.exports)}>
					<InvestigationActions
						compact
						blocked={operations.busy()}
						client={client()}
						disabled={
							!summary() ||
							(mode() === "corpus"
								? searching()
								: localization.active()
									? qualityTabCount() === undefined
									: !qualitySummary())
						}
						revision={[summary(), qualitySummary()]}
						query={{
							mode: mode() === "quality" ? "quality" : "corpus",
							query: query(),
							capability: capability(),
							lens: lens(),
							withoutNotes: withoutNotes(),
							...whereField(),
							...(searchRequest().filter
								? { filter: searchRequest().filter }
								: undefined),
							...groupField(),
							// Problem and translation pills need the target, as the list does.
							...localizationField(),
							qualityFilter: sourceFilter(),
							...(mode() === "quality" && localization.active()
								? { workspaceFilter: qualityFilter() }
								: undefined)
						}}
						onOpen={restorePreset}
						onRequestOpen={(open) => guardRules(open)}
						disabledReason={
							mode() === "quality"
								? "Wait for findings to load, or load a rules file to check source text."
								: "Wait for the search to finish before exporting."
						}
						extraExport={
							localization.active() && props.client.localizationLinesFile
								? {
										label: "All languages (CSV)",
										run: () => allLanguagesExport()
									}
								: undefined
						}
					/>
				</div>
			)}
		</Show>
	);

	const rulesSetup = () => (
		<section aria-label="Quality rules setup" {...stylex.attrs(styles.card)}>
			<p>
				<strong>Set up Quality checks</strong> with a rules file for character limits and
				terminology. The starter file contains examples you can customize.
			</p>
			<Show when={qualityFailure()}>
				{(issue) => (
					<p role="alert">
						{issue().message} {issue().recovery}
					</p>
				)}
			</Show>
			<div {...stylex.attrs(styles.bar)}>
				<Show when={props.client.createStarterRules}>
					<Button
						tone="primary"
						disabled={operations.busy()}
						onClick={() => loadRules(false)}
					>
						Create rules file
					</Button>
				</Show>
				<Show when={qualityFailure()?.code === "already_exists"}>
					<Button disabled={operations.busy()} onClick={() => loadRules(true)}>
						Load existing rules
					</Button>
				</Show>
				<Button disabled={operations.busy()} onClick={() => loadRules()}>
					Load rules
				</Button>
			</div>
		</section>
	);
	return (
		<main {...stylex.attrs(styles.page)}>
			<Show when={persistenceFailed()}>
				<p role="alert">
					Draft recovery could not be saved locally. Keep this workspace open until you
					stage or save your changes.
				</p>
			</Show>
			<Show when={replacement()}>
				<section
					role="alertdialog"
					aria-label="Unsaved quality rules"
					{...stylex.attrs(styles.card)}
				>
					<p>
						Quality rules have unsaved changes. Discard them before replacing the rules?
					</p>
					<Button onClick={() => setReplacement(undefined)}>Keep editing</Button>
					<Button
						onClick={() => {
							const next = replacement();
							setReplacement(undefined);
							next?.();
						}}
					>
						Discard and continue
					</Button>
				</section>
			</Show>
			<div {...stylex.attrs(styles.toolbar)}>
				<h1 {...stylex.attrs(styles.heading)}>Game Text</h1>
				<div
					role="tablist"
					aria-label="Game Text view"
					{...stylex.attrs(styles.bar)}
					onKeyDown={(event) => {
						if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
						const tabs = Array.from(
							event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')
						);
						const index =
							event.target instanceof HTMLButtonElement
								? tabs.indexOf(event.target)
								: -1;
						const next =
							event.key === "Home"
								? 0
								: event.key === "End"
									? tabs.length - 1
									: (index + (event.key === "ArrowLeft" ? -1 : 1) + tabs.length) %
										tabs.length;
						event.preventDefault();
						tabs[next]?.click();
						tabs[next]?.focus();
					}}
				>
					<ToolButton
						label="Text"
						tooltip="Browse source lines and translations."
						role="tab"
						id="game-text-tab-corpus"
						aria-controls="game-text-panel-corpus"
						tabindex={mode() === "corpus" ? 0 : -1}
						aria-selected={mode() === "corpus" ? "true" : "false"}
						onClick={() => setMode("corpus")}
					>
						<ToolIcon name="text" />
					</ToolButton>
					<ToolButton
						label={
							"Quality checks" +
							(editor.dirty() ? " · Unsaved" : "") +
							(qualityFailure()?.code === "invalid_rules"
								? " (rules invalid)"
								: qualityTabCount() !== undefined
									? " (" + qualityTabCount() + ")"
									: "")
						}
						tooltip="Inspect findings and edit character limits and terminology rules."
						badge={
							qualityFailure()?.code === "invalid_rules"
								? "!"
								: editor.dirty()
									? "•"
									: qualityTabCount() || undefined
						}
						role="tab"
						id="game-text-tab-quality"
						aria-controls="game-text-panel-quality"
						tabindex={mode() === "quality" ? 0 : -1}
						aria-selected={mode() === "quality" ? "true" : "false"}
						onClick={() => setMode("quality")}
					>
						<ToolIcon name="checks" />
					</ToolButton>
					<Show when={localization.active()}>
						<ToolButton
							label="Reports"
							tooltip="Inspect localization progress and target reports."
							role="tab"
							id="game-text-tab-reports"
							aria-controls="game-text-panel-reports"
							tabindex={mode() === "reports" ? 0 : -1}
							aria-selected={mode() === "reports" ? "true" : "false"}
							onClick={() => setMode("reports")}
						>
							<ToolIcon name="reports" />
						</ToolButton>
					</Show>
				</div>
				<div {...stylex.attrs(styles.headerActions)}>
					<LocalizationControls
						model={localization}
						disabled={operations.busy() || edits.working()}
						cultureWork={page()?.facets?.cultures}
						syncAction={
							<SyncWithUnreal
								model={operations}
								pending={localization.active()?.notSynced ?? 0}
							/>
						}
					/>
					<StagedEditsButton model={edits} />
					<UnrealSteps model={operations} />

					<Show when={summary()}>
						<ToolButton
							label="Rescan"
							tooltip={
								operations.reason() ??
								"Refresh saved text and translations from the project. Keeps your current list and drafts."
							}
							disabled={indexBusy() || operations.busy()}
							onClick={() => load(true)}
						>
							<ToolIcon name="refresh" />
						</ToolButton>
					</Show>
				</div>
				<span aria-label="Index status" {...stylex.attrs(styles.coverage)}>
					<Show
						when={indexBusy()}
						fallback={
							<Show
								when={summary()}
								fallback={
									projectAvailable()
										? "Ready to scan project"
										: "No project selected"
								}
							>
								{(current) => (
									<>
										<Show
											when={localization.ready()}
											fallback={
												<span role="status">
													{localization.error()
														? "Translations unavailable"
														: "Loading translations…"}
												</span>
											}
										>
											<b>
												{(
													localization.active()?.lines ??
													current().counts.all
												).toLocaleString()}
											</b>{" "}
											{(localization.active()?.lines ??
												current().counts.all) === 1
												? "line"
												: "lines"}{" "}
											{localization.active() ? "· " : "in "}
										</Show>
										<b>
											{current().coverage.inspectedPackages.toLocaleString()}
										</b>{" "}
										{current().coverage.inspectedPackages === 1
											? "asset"
											: "assets"}
										<Show when={current().scannedAt}>
											{" "}
											· scanned {scanTime(current().scannedAt)}
										</Show>
										<ReadProblems summary={current()} />
										<Show
											when={
												!indexBusy() && preparationSeconds() !== undefined
											}
										>
											{" · ready in "}
											{elapsedTime(preparationSeconds() ?? 0)}
										</Show>
									</>
								)}
							</Show>
						}
					>
						<span role="status" {...stylex.attrs(styles.indexProgress)}>
							<span>
								{loading()
									? summary()
										? "Rescanning"
										: "Opening saved text index"
									: "Preparing translations and results"}
							</span>
							{" · "}
							{progressLabel()}
							<Show when={progressTotal() > 0}>
								{" · "}
								{progress().completed.toLocaleString()} /{" "}
								{progressTotal().toLocaleString()}
							</Show>
							{" · "}
							{elapsedTime(elapsedSeconds())} elapsed
						</span>
					</Show>
				</span>
				<Show when={indexBusy()}>
					<GameTextScanProgress
						label={progressLabel()}
						completed={progress().completed}
						total={progressTotal()}
					/>
				</Show>
			</div>
			<Show when={mode() === "corpus"}>
				<BrowseSummary
					page={page()}
					culture={localization.culture()}
					cultures={localization.cultures()}
				/>
			</Show>
			<OperationPanel model={operations} />
			<StagedEditsPanel model={edits} />
			<Show when={localization.error()}>
				<p role="alert" {...stylex.attrs(styles.problemMessage)}>
					{localization.error()}{" "}
					<Button size="compact" onClick={localization.load}>
						Retry translations
					</Button>
				</p>
			</Show>
			<Show
				when={
					!localization.active() &&
					!localization.error() &&
					filter().some(
						(clause) =>
							clause.field === "translation" ||
							(clause.field === "problem" &&
								clause.values.some((value) => localizationProblems.has(value)))
					)
				}
			>
				<p role="note">
					Localization-dependent filter values are paused until a target is available.
					Source filters still apply.
				</p>
			</Show>
			<Show when={scanNotice()}>
				<p role="status" {...stylex.attrs(styles.problemMessage)}>
					{scanNotice()}
				</p>
			</Show>
			<Show when={error()}>
				{(message) => (
					<div role="alert" {...stylex.attrs(styles.card)}>
						{message()}
						<Button onClick={() => retryError()?.()}>Retry</Button>
					</div>
				)}
			</Show>
			<Show when={mode() === "quality" && qualitySummary() && qualityFailure()}>
				<p role="alert" {...stylex.attrs(styles.card)}>
					{qualityFailure()?.message} {qualityFailure()?.recovery}
					<Button onClick={() => loadRules()}>Load rules</Button>
				</p>
			</Show>
			<div
				role="tabpanel"
				id={"game-text-panel-" + mode()}
				aria-labelledby={"game-text-tab-" + mode()}
				{...stylex.attrs(styles.workspace)}
			>
				<Show
					when={summary()}
					fallback={
						<div {...stylex.attrs(styles.empty)}>
							<Show
								when={!loading()}
								fallback={<span role="status">Loading saved game text…</span>}
							>
								<p>
									Game Text reads the project's saved assets, so Unreal does not
									need to be running.
								</p>
								<Show
									when={projectAvailable()}
									fallback={
										<p>
											Choose a project using the workspace project picker,
											then return here.
										</p>
									}
								>
									<Button tone="primary" onClick={() => load(true)}>
										Scan project
									</Button>
								</Show>
							</Show>
						</div>
					}
				>
					<Show
						when={mode() !== "reports"}
						fallback={
							<Show
								when={localization.ready()}
								fallback={
									<p role="status" {...stylex.attrs(styles.empty)}>
										Loading translations…
									</p>
								}
							>
								<Show when={localization.target()}>
									{(target) => (
										<GameTextReports
											disabled={operations.busy()}
											client={props.client}
											target={target()}
											revision={summary()}
										/>
									)}
								</Show>
							</Show>
						}
					>
						<Show
							when={mode() === "corpus"}
							fallback={
								<Show
									when={
										localization.target() &&
										props.client.localizationQualitySearch
									}
									fallback={
										<Show when={qualitySummary()} fallback={rulesSetup()}>
											{(quality) => (
												<Show when={qualityDocument()}>
													{(document) => (
														<GameTextQualityWorkspace
															disabled={operations.busy()}
															client={props.client}
															summary={quality()}
															document={document()}
															editor={editor}
															filter={sourceFilter()}
															onFilterChange={setQualityFilter}
															onReplaceRules={reloadRules}
															onLoadRules={() => loadRules()}
															selectedId={selectedFindingId()}
															onSelectionChange={setSelectedFindingId}
															exports={exports()}
															onShowText={(id) => {
																localization.setSelectedId(
																	undefined
																);
																setSelectedId(id);
																setMode("corpus");
															}}
														/>
													)}
												</Show>
											)}
										</Show>
									}
								>
									<Show
										when={localization.ready()}
										fallback={
											<p role="status" {...stylex.attrs(styles.empty)}>
												Loading translations…
											</p>
										}
									>
										<GameTextLocalizationQuality
											disabled={operations.busy()}
											client={props.client}
											localization={localization}
											summary={qualitySummary()}
											document={qualityDocument()}
											editor={editor}
											setup={rulesSetup()}
											exports={exports()}
											filter={qualityFilter()}
											onFilterChange={setQualityFilter}
											selectedId={selectedFindingId()}
											onSelectionChange={setSelectedFindingId}
											onLoadRules={() => loadRules()}
											onReloadRules={reloadRules}
											onShowText={(id) => {
												localization.setSelectedId(undefined);
												setSelectedId(id);
												setMode("corpus");
											}}
										/>
									</Show>
								</Show>
							}
						>
							<div {...stylex.attrs(styles.workspace)}>
								<div {...stylex.attrs(styles.bar, styles.browseBar)}>
									<div {...stylex.attrs(styles.search)}>
										<svg
											aria-hidden="true"
											viewBox="0 0 24 24"
											{...stylex.attrs(styles.searchIcon)}
										>
											<circle cx="10" cy="10" r="6" />
											<path d="M15 15 L21 21" />
										</svg>
										<input
											ref={(element) => {
												searchInput = element;
											}}
											autofocus
											type="search"
											aria-label="Search game text"
											placeholder={
												localization.cultures().length > 0 &&
												localization.searchTranslations()
													? "Search text and translations"
													: "Search text"
											}
											maxlength={512}
											disabled={loading() && !summary()}
											value={query()}
											{...stylex.attrs(styles.input)}
											onInput={(event) => setQuery(event.currentTarget.value)}
											onKeyDown={(event) => {
												if (event.key === "Enter" && localization.ready())
													requestPage(searchRequest());
											}}
										/>
										<span role="status" {...stylex.attrs(styles.count)}>
											{localization.error() && !localization.ready()
												? "Translations unavailable"
												: searchFailed()
													? "Search failed"
													: searching() || !page()
														? "Searching…"
														: page()?.total === 1
															? "1 match"
															: page()?.total.toLocaleString() +
																" matches"}
										</span>
										<kbd {...stylex.attrs(browseStyles.keyboard)}>
											{/Mac|iPhone|iPad/.test(navigator.platform)
												? "⌘ K"
												: "Ctrl K"}
										</kbd>
									</div>

									<Show
										when={
											localization.active() &&
											localization.cultures().length > 0
										}
									>
										<ToolButton
											label="Search translations"
											tooltip={
												localization.searchTranslations()
													? "On. Search source text and translations in the picked cultures."
													: "Off. Search source text only. Turn on to include the picked cultures' translations."
											}
											aria-pressed={
												localization.searchTranslations() ? "true" : "false"
											}
											onClick={() =>
												localization.setSearchTranslations(
													!localization.searchTranslations()
												)
											}
										>
											<ToolIcon name="translations" />
										</ToolButton>
									</Show>
									<div {...stylex.attrs(styles.browseActions)}>
										<WhereFilter
											where={where()}
											counts={page()?.counts.origins}
											fileScope={page()?.fileScope}
											searching={searching()}
											disabled={loading() && !summary()}
											filesOnly
											onChange={setWhere}
										/>
										<FilterMenu
											filter={filter()}
											counts={filterCounts()}
											hasTarget={localization.active() !== undefined}
											disabled={loading() && !summary()}
											onChange={setFilter}
											extraFields={extraFields()}
											folderBrowser={(typed) => (
												<FolderBrowser
													menu
													typed={typed()}
													list={page()?.facets?.folders}
													folder={facetFolder()}
													filter={filter()}
													onFolderChange={setFacetFolder}
													onFilterChange={setFilter}
												/>
											)}
										/>
										<ToolButton
											label={
												paneCollapsed()
													? "Show side pane"
													: "Hide side pane"
											}
											tooltip={
												paneCollapsed()
													? "Restore line details and browse facets beside the list."
													: "Give the full width to the line list. Your selection and drafts are kept."
											}
											aria-pressed={paneCollapsed() ? "false" : "true"}
											onClick={() => {
												const hide = !paneCollapsed();
												setPaneCollapsed(hide);
												if (hide) closeLine();
											}}
										>
											<ToolIcon name="panel" />
										</ToolButton>
										<DisplayMenu
											group={
												group() === "none" ? undefined : groupField()?.group
											}
											disabled={loading() && !summary()}
											onGroupChange={(next) => setGroup(next ?? "none")}
										/>
										{exports()}
									</div>
								</div>
								<Show
									when={
										filter().length > 0 ||
										localization.state() ||
										localization.review()
									}
								>
									<div {...stylex.attrs(styles.bar)}>
										<FilterPills filter={filter()} onChange={setFilter} />
										<Show when={localization.state()}>
											{(state) => (
												<Chip
													label={localizationLabels[state()]}
													selected
													onClick={() => localization.setState(undefined)}
												/>
											)}
										</Show>
										<Show when={localization.review()}>
											{(review) => (
												<Chip
													label={reviewLensLabel(review())}
													selected
													onClick={() =>
														localization.setReview(undefined)
													}
												/>
											)}
										</Show>
									</div>
								</Show>
								<div
									{...stylex.attrs(
										styles.grid,
										collapsed() && styles.gridCollapsed
									)}
								>
									{/* Keep the paged list beside the line detail so selection, groups and pages survive. */}
									<section
										aria-label="Results"
										ref={(element) => {
											resultsSection = element;
										}}
										{...stylex.attrs(styles.pane)}
									>
										<GameTextColumns culture={localization.culture()} />
										<Show
											when={page()?.groups}
											fallback={
												<GameTextResultRows
													page={page()}
													culture={localization.culture()}
													cultures={localization.cultures()}
													selectedId={selectedId()}
													selectedLocalizationId={localization.selectedId()}
													onSelect={(unit, line) => {
														selectRow({ unit, line });
													}}
													checked={ticks()?.checked}
													onCheck={ticks()?.onCheck}
													checking={ticks()?.checking}
												/>
											}
										>
											{(groups) => (
												<GroupedResults
													revision={page()}
													by={groups().by}
													groups={groups().entries}
													more={groups().more}
													request={committedRequest() ?? searchRequest()}
													client={props.client}
													culture={localization.culture()}
													cultures={localization.cultures()}
													selectedId={selectedId()}
													selectedLocalizationId={localization.selectedId()}
													onSelect={(unit, line) => {
														selectRow({ unit, line });
													}}
													onLoaded={groupLoaded}
													ticks={ticks()}
												/>
											)}
										</Show>
										<Show
											when={
												localization.ready() &&
												!searching() &&
												page()?.total === 0
											}
										>
											<p {...stylex.attrs(styles.empty)}>
												No text matches {narrowing()}.
												<Button
													size="compact"
													onClick={() => {
														setQuery("");
														setFilter([]);
														setWhere(undefined);
														setCapability("all");
														setLens("all");
														setWithoutNotes(false);
														localization.setState(undefined);
														localization.setReview(undefined);
														localization.setKeyChanged(false);
														localization.selectCulture("");
													}}
												>
													Clear all
												</Button>
											</p>
										</Show>
										<Show
											when={
												!page()?.groups &&
												(page()?.localization?.nextCursor ??
													page()?.nextCursor)
											}
										>
											<Button disabled={searching()} onClick={moreResults}>
												Show{" "}
												{Math.min(
													50,
													(page()?.total ?? 0) -
														(page()?.localization?.lines.length ??
															page()?.units.length ??
															0)
												)}{" "}
												more
											</Button>
										</Show>
										<BulkBar
											selection={selection}
											client={props.client}
											localization={localization.selection()}
											cultures={localization.cultures()}
											nativeCulture={
												localization.active()?.target.nativeCulture ??
												undefined
											}
											edits={edits}
											busy={loading() || operations.busy()}
											onChanged={() => load(false)}
										/>
									</section>
									<aside
										aria-label="Text focus"
										ref={(element) => {
											linePane = element;
										}}
										{...stylex.attrs(
											styles.pane,
											collapsed() && styles.hiddenPane
										)}
									>
										<Show when={lineOpen()}>
											<LinePageHeader
												position={linePosition()}
												onBack={closeLine}
												onMove={moveLine}
											/>
										</Show>
										<div {...stylex.attrs(lineOpen() && styles.pageBody)}>
											<div>
												<Show when={lineOpen()}>
													<div {...stylex.attrs(styles.calloutBox)}>
														<LineProblem
															focus={focus()}
															detail={localization.detail()}
														/>
													</div>
												</Show>
												<Show
													when={focus()}
													fallback={
														<Show
															when={
																localization.detail()?.origin
																	.kind === "evidence"
																	? localization.detail()
																	: undefined
															}
															fallback={
																<Show
																	when={
																		!localization.detailLoading()
																	}
																	fallback={
																		<p
																			{...stylex.attrs(
																				styles.empty
																			)}
																		>
																			Loading translations…
																		</p>
																	}
																>
																	<FacetsPane
																		page={page()}
																		group={groupField()?.group}
																		filter={filter()}
																		folder={facetFolder()}
																		onFolderChange={
																			setFacetFolder
																		}
																		onFilterChange={setFilter}
																	/>
																</Show>
															}
														>
															{(gathered) => (
																<div
																	{...stylex.attrs(styles.detail)}
																>
																	<GatheredDetail
																		focus={gathered()}
																	/>
																	<TranslationsDetail
																		model={localization}
																		edits={edits}
																		review={{
																			client: props.client,
																			busy:
																				loading() ||
																				operations.busy(),
																			onChanged: () =>
																				load(false)
																		}}
																	/>
																</div>
															)}
														</Show>
													}
												>
													{(current) => (
														<div {...stylex.attrs(styles.detail)}>
															<div {...stylex.attrs(styles.bar)}>
																<h2 {...stylex.attrs(styles.title)}>
																	{sourceText(current().unit)}
																</h2>
																<CopyButton
																	label="Copy text"
																	value={sourceText(
																		current().unit
																	)}
																/>
															</div>
															<div {...stylex.attrs(styles.bar)}>
																<code
																	{...stylex.attrs(styles.mono)}
																>
																	{identityLabel(current().unit)}
																</code>
																<Show
																	when={
																		current().unit.identity
																			.status !== "unresolved"
																	}
																>
																	<CopyButton
																		label="Copy key"
																		value={identityLabel(
																			current().unit
																		)}
																	/>
																</Show>
															</div>
															<span {...stylex.attrs(styles.muted)}>
																{focusStats(current())}
															</span>
															<Show
																when={current().unit.reviewSignals.some(
																	(signal) =>
																		signal !== "evidence_only"
																)}
															>
																<span
																	{...stylex.attrs(styles.muted)}
																>
																	{current()
																		.unit.reviewSignals.filter(
																			(signal) =>
																				signal !==
																				"evidence_only"
																		)
																		.map(textReviewSignalLabel)
																		.join(" · ")}
																</span>
															</Show>
															<TranslationsDetail
																model={localization}
																edits={edits}
																review={{
																	client: props.client,
																	busy:
																		loading() ||
																		operations.busy(),
																	onChanged: () => load(false)
																}}
															/>
															<h3 {...stylex.attrs(styles.section)}>
																Where it appears
															</h3>
															<For each={current().occurrences}>
																{(occurrence) => (
																	<OccurrenceCard
																		client={props.client}
																		occurrence={occurrence}
																		conflicting={
																			current().unit.source
																				.status ===
																			"conflicting"
																		}
																		onOpenDataAuthoring={
																			props.onOpenDataAuthoring
																		}
																	/>
																)}
															</For>
															<CoverageNotes
																diagnostics={current().diagnostics}
															/>
															<Show
																when={
																	current().nextOccurrenceCursor
																}
															>
																{(cursor) => (
																	<Button
																		onClick={() =>
																			requestFocus(
																				current().unit.id,
																				cursor()
																			)
																		}
																	>
																		Show{" "}
																		{textCountLabel(
																			Math.min(
																				50,
																				current()
																					.totalOccurrences -
																					current()
																						.occurrences
																						.length
																			),
																			"more location"
																		)}
																	</Button>
																)}
															</Show>
														</div>
													)}
												</Show>
											</div>
											<Show when={lineOpen()}>
												<LineProperties
													focus={focus()}
													detail={localization.detail()}
												/>
											</Show>
										</div>
									</aside>
								</div>
							</div>
						</Show>
					</Show>
				</Show>
			</div>
			<Show when={mode() === "corpus" ? summary() : undefined}>
				{(_current) => (
					<footer {...stylex.attrs(browseStyles.footer)}>
						<Show when={queryMs() !== undefined}>
							<span title="Last successful query round trip, excluding the typing debounce">
								Last query {Math.round(queryMs() ?? 0)} ms
							</span>
						</Show>
						<span {...stylex.attrs(styles.grow)} />
						<span>
							{textCountLabel(
								localization.active()?.target.cultures.length ?? 0,
								"culture"
							)}
						</span>
					</footer>
				)}
			</Show>
		</main>
	);
}

export function OccurrenceCard(props: {
	readonly client: Pick<GameTextClientApi, "locateAsset">;
	readonly occurrence: TextOccurrence;
	readonly conflicting: boolean;
	readonly onOpenDataAuthoring?: ((objectPath: string) => void) | undefined;
}) {
	return (
		<article {...stylex.attrs(styles.card)}>
			<div {...stylex.attrs(styles.toolbar)}>
				<strong>{textLocationLabel(props.occurrence.location)}</strong>
				<span {...stylex.attrs(styles.coverage)}>
					{props.occurrence.editCapability === "source_editable"
						? "Editable"
						: "Read only"}
				</span>
			</div>
			<code {...stylex.attrs(styles.mono)}>{props.occurrence.location.objectPath}</code>
			<span {...stylex.attrs(styles.muted)}>{locationDetail(props.occurrence.location)}</span>
			<Show when={props.conflicting}>
				<p {...stylex.attrs(styles.notes)}>{props.occurrence.source}</p>
			</Show>
			<Show
				when={props.occurrence.devNotes.trim()}
				fallback={<span {...stylex.attrs(styles.muted)}>No translator notes</span>}
			>
				<p {...stylex.attrs(styles.notes)}>{props.occurrence.devNotes}</p>
			</Show>
			<details>
				<summary {...stylex.attrs(styles.muted)}>Saved file</summary>
				<code {...stylex.attrs(styles.mono)}>{props.occurrence.packageFile}</code>
			</details>
			<div {...stylex.attrs(styles.bar)}>
				<CopyButton label="Copy asset path" value={props.occurrence.location.objectPath} />
				<ShowInUnrealButton
					client={props.client}
					objectPath={props.occurrence.location.objectPath}
				/>
				<Show
					when={
						props.occurrence.location.kind === "data_table_cell" &&
						props.onOpenDataAuthoring
					}
				>
					<Button
						size="compact"
						tone="quiet"
						onClick={() =>
							props.onOpenDataAuthoring?.(props.occurrence.location.objectPath)
						}
					>
						Open in Data Authoring
					</Button>
				</Show>
			</div>
		</article>
	);
}
