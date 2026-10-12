import * as stylex from "@stylexjs/stylex";
import type { LocalizationState, TextCorpusSearchPage } from "@ue-shed/game-text/browser";
import { tokens } from "@ue-shed/ui-theme/tokens.stylex.js";
import { For, Show } from "solid-js";
import { localizationLabels } from "./game-text-localization-view.js";

export function browseStateLabel(state: LocalizationState): string {
	return localizationLabels[state];
}

const states = ["translated", "needs_update", "not_translated", "outside_target"] as const;

/** Counts are supplied by the query over matching lines and the picked cultures. They can
 * overlap across cultures, so they are not presented as parts of one percentage bar. */
export function BrowseSummary(props: {
	readonly page: TextCorpusSearchPage | undefined;
	readonly culture: string | undefined;
	readonly cultures: readonly string[];
}) {
	return (
		<Show when={props.page?.localization}>
			{(localization) => (
				<section aria-label="Translation summary" {...stylex.attrs(styles.summary)}>
					<span {...stylex.attrs(styles.scope)}>
						{props.culture ??
							(props.cultures.length ? "Picked cultures" : "All cultures")}
						<span {...stylex.attrs(styles.muted)}> · matching lines</span>
					</span>
					<For each={states}>
						{(state) => (
							<span {...stylex.attrs(styles.stat)}>
								<span
									aria-hidden="true"
									{...stylex.attrs(styles.dot, stateTone(state))}
								/>
								{browseStateLabel(state)}{" "}
								<b>{localization().stateCounts[state].toLocaleString()}</b>
							</span>
						)}
					</For>
				</section>
			)}
		</Show>
	);
}

export function BrowseStateFilter(props: {
	readonly selected: LocalizationState | undefined;
	readonly onChange: (state: LocalizationState | undefined) => void;
}) {
	return (
		<div role="group" aria-label="Translation state" {...stylex.attrs(styles.segmented)}>
			<button
				type="button"
				aria-pressed={props.selected === undefined ? "true" : "false"}
				onClick={() => props.onChange(undefined)}
				{...stylex.attrs(styles.segment, props.selected === undefined && styles.active)}
			>
				All
			</button>
			<For each={states}>
				{(state) => (
					<button
						type="button"
						aria-pressed={props.selected === state ? "true" : "false"}
						onClick={() => props.onChange(props.selected === state ? undefined : state)}
						{...stylex.attrs(styles.segment, props.selected === state && styles.active)}
					>
						{browseStateLabel(state)}
					</button>
				)}
			</For>
		</div>
	);
}

export function stateTone(state: LocalizationState | undefined) {
	if (state === "translated") return styles.success;
	if (state === "not_translated") return styles.danger;
	if (state === "needs_update" || state === "not_gathered" || state === "changed_since_gather")
		return styles.warning;
	if (state === "not_synced") return styles.accent;
	return styles.neutral;
}

export const browseStyles = stylex.create({
	footer: {
		display: "flex",
		alignItems: "center",
		gap: 16,
		minHeight: 26,
		paddingInline: 16,
		borderTopWidth: 1,
		borderTopStyle: "solid",
		borderTopColor: tokens.colorBorder,
		color: tokens.colorTextMuted,
		fontSize: 11,
		fontVariantNumeric: "tabular-nums",
		flexShrink: 0
	},
	badge: {
		borderRadius: tokens.radiusBadge,
		padding: "2px 6px",
		backgroundColor: tokens.colorSurfaceRaised,
		fontSize: 11,
		whiteSpace: "nowrap"
	},
	keyboard: {
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: tokens.colorBorder,
		borderRadius: tokens.radiusBadge,
		padding: "1px 5px",
		color: tokens.colorTextFaint,
		fontFamily: tokens.fontMono,
		fontSize: 10,
		whiteSpace: "nowrap"
	}
});

const styles = stylex.create({
	summary: {
		display: "flex",
		flexWrap: "wrap",
		alignItems: "center",
		gap: "8px 16px",
		padding: "8px 16px",
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: tokens.colorBorder,
		color: tokens.colorTextMuted,
		fontSize: 12,
		flexShrink: 0
	},
	scope: { color: tokens.colorText, fontWeight: 500 },
	muted: { color: tokens.colorTextMuted, fontWeight: 400 },
	stat: {
		display: "inline-flex",
		alignItems: "center",
		gap: 6,
		fontVariantNumeric: "tabular-nums"
	},
	dot: { width: 7, height: 7, borderRadius: 2, backgroundColor: "currentColor" },
	success: { color: tokens.colorSuccess },
	warning: { color: tokens.colorWarning },
	danger: { color: tokens.colorDanger },
	accent: { color: tokens.colorAccent },
	neutral: { color: tokens.colorTextMuted },
	segmented: {
		display: "flex",
		padding: 2,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: tokens.colorBorder,
		borderRadius: tokens.radiusControl,
		backgroundColor: tokens.colorSurfaceInset
	},
	segment: {
		borderWidth: 0,
		borderRadius: 4,
		padding: "4px 8px",
		backgroundColor: { default: "transparent", ":hover": tokens.colorSurfaceHover },
		color: tokens.colorTextMuted,
		fontFamily: tokens.fontBody,
		fontSize: 12,
		cursor: "pointer",
		whiteSpace: "nowrap",
		":focus-visible": { outline: `1px solid ${tokens.colorAccent}` }
	},
	active: { backgroundColor: tokens.colorSurfaceRaised, color: tokens.colorTextStrong }
});
