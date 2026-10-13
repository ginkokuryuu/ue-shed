import * as stylex from "@stylexjs/stylex";
import { tokens } from "@ue-shed/ui-theme/tokens.stylex.js";
import { For, Show } from "solid-js";

export interface ViewTab<Id extends string> {
	readonly id: Id;
	readonly label: string;
	/** A short count or mark beside the label. */
	readonly badge?: string | undefined;
	/** What the badge means, read with the tab's name ("Quality checks, 3 findings"). */
	readonly badgeLabel?: string | undefined;
	readonly badgeTone?: "danger" | "accent" | undefined;
}

/**
 * The workspace's views as a segmented switch: one track, with the chosen view filled in. Arrow
 * keys, Home and End move between them and select, as in a tab list.
 */
export function ViewTabs<Id extends string>(props: {
	readonly label: string;
	/** Tab ids are `${idPrefix}-tab-${id}`, and each controls `${idPrefix}-panel-${id}`. */
	readonly idPrefix: string;
	readonly tabs: readonly ViewTab<Id>[];
	readonly selected: Id;
	readonly onSelect: (id: Id) => void;
}) {
	return (
		<div
			role="tablist"
			aria-label={props.label}
			{...stylex.attrs(styles.list)}
			onKeyDown={(event) => {
				if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
				const tabs = Array.from(
					event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')
				);
				const index =
					event.target instanceof HTMLButtonElement ? tabs.indexOf(event.target) : -1;
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
			<For each={props.tabs} keyed={(tab) => tab.id}>
				{(tab) => {
					const selected = () => props.selected === tab().id;
					return (
						<button
							type="button"
							role="tab"
							id={`${props.idPrefix}-tab-${tab().id}`}
							aria-controls={`${props.idPrefix}-panel-${tab().id}`}
							aria-selected={selected() ? "true" : "false"}
							aria-label={
								tab().badgeLabel ? `${tab().label}, ${tab().badgeLabel}` : undefined
							}
							tabindex={selected() ? 0 : -1}
							onClick={() => props.onSelect(tab().id)}
							{...stylex.attrs(styles.tab, selected() && styles.selected)}
						>
							{tab().label}
							<Show when={tab().badge}>
								{(badge) => (
									<span
										aria-hidden="true"
										{...stylex.attrs(
											styles.badge,
											selected() && styles.selectedBadge,
											tab().badgeTone === "danger" && styles.danger,
											tab().badgeTone === "accent" && styles.accent
										)}
									>
										{badge()}
									</span>
								)}
							</Show>
						</button>
					);
				}}
			</For>
		</div>
	);
}

const styles = stylex.create({
	// An inset track holding the views, so it reads as one switch with one choice made.
	list: {
		display: "inline-flex",
		alignItems: "center",
		flexShrink: 0,
		gap: 2,
		padding: 2,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: tokens.colorBorder,
		borderRadius: tokens.radiusControl,
		backgroundColor: tokens.colorSurfaceInset
	},
	tab: {
		display: "inline-flex",
		alignItems: "center",
		gap: 6,
		height: 24,
		paddingInline: 10,
		borderWidth: 0,
		borderRadius: 4,
		backgroundColor: { default: "transparent", ":hover": tokens.colorSurfaceHover },
		color: { default: tokens.colorTextMuted, ":hover": tokens.colorText },
		fontFamily: tokens.fontBody,
		fontSize: 12,
		fontWeight: 500,
		whiteSpace: "nowrap",
		cursor: "pointer",
		outline: { default: "none", ":focus-visible": `2px solid ${tokens.colorAccent}` },
		outlineOffset: 1
	},
	selected: {
		backgroundColor: { default: tokens.colorBorder, ":hover": tokens.colorBorder },
		boxShadow: `inset 0 0 0 1px ${tokens.colorBorderStrong}`,
		color: { default: tokens.colorTextStrong, ":hover": tokens.colorTextStrong },
		cursor: "default"
	},
	badge: {
		minWidth: 16,
		paddingInline: 5,
		borderRadius: tokens.radiusBadge,
		backgroundColor: tokens.colorBorder,
		color: tokens.colorText,
		fontSize: 11,
		fontWeight: 400,
		lineHeight: "16px",
		textAlign: "center",
		fontVariantNumeric: "tabular-nums"
	},
	selectedBadge: { backgroundColor: tokens.colorBorderStrong },
	danger: { color: tokens.colorDanger },
	accent: { color: tokens.colorAccent }
});
