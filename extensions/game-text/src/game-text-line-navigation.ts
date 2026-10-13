import type {
	LocalizationLineId,
	TextCorpusSearchPage,
	TextGroupBy,
	TextUnitId
} from "@ue-shed/game-text/browser";
import { createEffect, createSignal, untrack } from "solid-js";
import { loadedRows, type GroupLoaded, type LoadedRow } from "./game-text-grouped-results.js";
import type { LinePosition } from "./game-text-line-page.js";

/**
 * The open line's page and how it moves through the list. A picked line opens its page. Its place
 * and neighbours come from the rows each group reports, or the flat page's rows, so the page
 * follows grouping, open groups and loaded pages.
 */
export function createLineNavigation(input: {
	readonly page: () => TextCorpusSearchPage | undefined;
	readonly group: () => TextGroupBy | "none";
	readonly unit: () => TextUnitId | undefined;
	readonly setUnit: (unit: TextUnitId | undefined) => void;
	readonly line: () => LocalizationLineId | undefined;
	readonly setLine: (line: LocalizationLineId | undefined) => void;
	/** Loads the flat list's next page. */
	readonly moreResults: () => void;
	/** Takes focus when a closed line's row is no longer listed. */
	readonly focusSearch: () => void;
}) {
	let list: HTMLElement | undefined;
	let pane: HTMLElement | undefined;
	let returnRow: HTMLElement | undefined;
	const [paneCollapsed, setPaneCollapsed] = createSignal(false);
	const lineOpen = () => input.unit() !== undefined || input.line() !== undefined;
	const collapsed = () => paneCollapsed() && !lineOpen();
	const [groupRows, setGroupRows] = createSignal<ReadonlyMap<string, readonly LoadedRow[]>>(
		new Map()
	);
	// A line only in the gather has no unit, so a closed page (no unit either) must not match it.
	const isOpenLine = (row: LoadedRow) => {
		const line = input.line();
		if (line !== undefined) return row.line === line;
		const unit = input.unit();
		return unit !== undefined && row.unit === unit;
	};
	const flatRows = (): readonly LoadedRow[] => {
		const current = input.page();
		return current ? loadedRows(current) : [];
	};
	// Where the open line is: its group (if grouped) and its place in that group's loaded rows.
	const openLineAt = () => {
		const groups = input.page()?.groups?.entries;
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
	// Folder, asset and origin groups list a line in each place it is used, so counting across them
	// would overshoot the total; there the place is counted within the line's group.
	const linePosition = (): LinePosition | undefined => {
		const current = input.page();
		const at = openLineAt();
		if (current === undefined || at === undefined) return undefined;
		const groups = current.groups?.entries;
		const entry = groups?.[at.group];
		if (groups === undefined || entry === undefined)
			return {
				index: at.index,
				total: current.total,
				first: at.index === 0,
				last: at.index + 1 >= current.total
			};
		const first = at.group === 0 && at.index === 0;
		const last = at.group === groups.length - 1 && at.index + 1 >= entry.count;
		const by = input.group();
		return by === "folder" || by === "asset" || by === "origin"
			? {
					index: at.index,
					total: entry.count,
					group: entry.label || "the project root",
					first,
					last
				}
			: { index: at.before + at.index, total: current.total, first, last };
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
	// Without groups, a step past the loaded rows loads the next page and picks this row.
	let pendingFlat: { readonly index: number; readonly from: LoadedRow } | undefined;
	const cancelSteps = () => {
		pendingFlat = undefined;
		pendingStep = undefined;
	};
	const selectRow = (row: LoadedRow | undefined) => {
		if (row === undefined) return;
		if (
			document.activeElement instanceof HTMLElement &&
			document.activeElement.hasAttribute("data-row")
		)
			returnRow = document.activeElement;
		setPaneCollapsed(false);
		input.setUnit(row.unit);
		input.setLine(row.line);
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
	createEffect(flatRows, (rows) => {
		const step = pendingFlat;
		if (step === undefined || rows.length <= step.index) return;
		pendingFlat = undefined;
		if (stillOpen(step.from)) selectRow(rows[step.index]);
	});
	// Opening a closed group goes through its header, as a click would.
	const groupControl = (key: string, selector: string) =>
		Array.from(list?.querySelectorAll<HTMLElement>("section[data-group]") ?? [])
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
		const current = input.page();
		const groups = current?.groups?.entries;
		if (!groups) {
			if (step === 1 && (current?.localization?.nextCursor ?? current?.nextCursor)) {
				pendingFlat = { index: at.index + 1, from };
				input.moreResults();
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
	createEffect(lineOpen, (open) => {
		if (open)
			queueMicrotask(() =>
				pane?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true })
			);
	});
	createEffect(
		() => ({ unit: input.unit(), line: input.line() }),
		() => {
			queueMicrotask(() =>
				list
					?.querySelector<HTMLElement>('[data-row][aria-current="true"]')
					?.scrollIntoView?.({ block: "nearest" })
			);
		}
	);
	const [focusBack, setFocusBack] = createSignal<LoadedRow>();
	createEffect(
		() => ({ wanted: focusBack(), page: input.page(), groups: groupRows() }),
		({ wanted }) => {
			if (!wanted) return;
			queueMicrotask(() => {
				const row = Array.from(
					list?.querySelectorAll<HTMLElement>("[data-row]") ?? []
				).find((element) =>
					wanted.line
						? element.dataset.line === wanted.line
						: wanted.unit !== undefined && element.dataset.unit === wanted.unit
				);
				if (row) {
					row.focus({ preventScroll: true });
					setFocusBack(undefined);
				}
			});
		}
	);
	/** Closes the line's page; focus returns to its row unless the caller keeps it. */
	const closeLine = (returnFocus = true) => {
		const row =
			list?.querySelector<HTMLElement>('[data-row][aria-current="true"]') ?? returnRow;
		cancelSteps();
		if (returnFocus) setFocusBack({ unit: input.unit(), line: input.line() });
		input.setUnit(undefined);
		input.setLine(undefined);
		if (!returnFocus) return;
		queueMicrotask(() => {
			if (row?.isConnected) row.focus({ preventScroll: true });
			else input.focusSearch();
		});
	};
	return {
		/** The list element holding the rows, for focus and scroll. */
		setList: (element: HTMLElement) => {
			list = element;
		},
		/** The side pane, which takes focus when a line opens. */
		setPane: (element: HTMLElement) => {
			pane = element;
		},
		lineOpen,
		paneCollapsed,
		setPaneCollapsed,
		/** The side pane is hidden, which only holds while no line is open. */
		collapsed,
		groupRows,
		groupLoaded,
		linePosition,
		selectRow,
		moveLine,
		closeLine,
		/** A new search replaces the rows a pending step was counting on. */
		cancelSteps
	};
}
