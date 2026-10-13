import * as stylex from "@stylexjs/stylex";
import { Portal, type ComponentProps, type JSX } from "@solidjs/web";
import { tokens } from "@ue-shed/ui-theme/tokens.stylex.js";
import { Show, createEffect, createSignal, createUniqueId, omit, onCleanup } from "solid-js";
import { isReturningFocus } from "./focus.js";

const tooltipOpened = "ue-shed:tool-tooltip-open";

export type ToolButtonProps = Omit<
	ComponentProps<"button">,
	"class" | "style" | "title" | "aria-label" | "children"
> & {
	/** Accessible name, and the tooltip heading for icon-only tools. */
	readonly label: string;
	/**
	 * Description shown in the tooltip. Icon-only tools always show a tooltip led by `label`; a
	 * tool with `showLabel` shows only this description, or no tooltip when it is omitted.
	 */
	readonly tooltip?: string | undefined;
	/** The icon. Optional when `showLabel` renders a text-only tool. */
	readonly children?: JSX.Element;
	readonly badge?: number | string | undefined;
	/**
	 * Spoken form of `badge`, appended to the accessible name as "Label, badgeLabel" (for example
	 * "3 active"). Defaults to the badge value itself; pass "" when `label` already states it.
	 */
	readonly badgeLabel?: string | undefined;
	/** Show `label` as text beside the icon, for primary controls; secondary tools stay icon-only. */
	readonly showLabel?: boolean | undefined;
};

/**
 * Tool with a keyboard-accessible tooltip and persistent selected state. The tooltip lets the
 * pointer pass through, so it never stands between the pointer and a neighbouring control; its
 * text is also the tool's description for assistive technology.
 */
export function ToolButton(props: ToolButtonProps) {
	const buttonProps = omit(
		props,
		"children",
		"label",
		"tooltip",
		"badge",
		"badgeLabel",
		"showLabel"
	);
	const id = createUniqueId();
	const [open, setOpen] = createSignal(false);
	const [position, setPosition] = createSignal({ left: 0, top: 0 });
	let anchor: HTMLSpanElement | undefined;
	let tooltip: HTMLDivElement | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	// Chromium focuses a pressed button on mousedown; that focus is not a keyboard visit.
	let pressed = false;
	let focusOpened = false;
	const expanded = () => props["aria-expanded"] === "true";
	const selected = () =>
		expanded() || props["aria-pressed"] === "true" || props["aria-selected"] === "true";
	const disabled = () => props.disabled !== undefined && props.disabled !== false;
	const hasTooltip = () => !props.showLabel || Boolean(props.tooltip);
	const accessibleName = () => {
		const spoken = props.badge === undefined ? "" : (props.badgeLabel ?? String(props.badge));
		return spoken ? `${props.label}, ${spoken}` : props.label;
	};
	const cancelTimer = () => {
		clearTimeout(timer);
		timer = undefined;
	};
	const close = () => {
		cancelTimer();
		focusOpened = false;
		setOpen(false);
	};
	const show = (delay = 0, viaFocus = false) => {
		cancelTimer();
		if (expanded() || !hasTooltip()) return;
		if (open()) {
			focusOpened ||= viaFocus;
			return;
		}
		const reveal = () => {
			anchor?.dispatchEvent(new Event(tooltipOpened, { bubbles: true }));
			focusOpened = viaFocus;
			setOpen(true);
		};
		if (delay) timer = setTimeout(reveal, delay);
		else reveal();
	};
	const leave = () => {
		cancelTimer();
		pressed = false;
		// A tooltip opened by keyboard focus stays while the tool keeps focus.
		if (focusOpened && anchor?.contains(document.activeElement)) return;
		timer = setTimeout(() => setOpen(false), 120);
	};
	const updatePosition = () => {
		if (!anchor || !tooltip) return;
		const bounds = anchor.getBoundingClientRect();
		const box = tooltip.getBoundingClientRect();
		setPosition({
			left: Math.max(8, Math.min(bounds.left, window.innerWidth - box.width - 8)),
			top: Math.max(
				8,
				bounds.bottom + box.height + 7 <= window.innerHeight - 8
					? bounds.bottom + 7
					: bounds.top - box.height - 7
			)
		});
	};
	createEffect(expanded, (value) => {
		if (value) close();
	});
	// Document listeners and positioning exist only while this tooltip is open.
	createEffect(open, (value) => {
		if (!value) return;
		const ownerDocument = anchor?.ownerDocument ?? document;
		const dismissOther = (event: Event) => {
			if (event.target !== anchor) close();
		};
		const escape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			close();
		};
		const frame = requestAnimationFrame(updatePosition);
		ownerDocument.addEventListener("keydown", escape);
		ownerDocument.addEventListener(tooltipOpened, dismissOther);
		window.addEventListener("resize", updatePosition);
		window.addEventListener("scroll", updatePosition, true);
		return () => {
			cancelAnimationFrame(frame);
			ownerDocument.removeEventListener("keydown", escape);
			ownerDocument.removeEventListener(tooltipOpened, dismissOther);
			window.removeEventListener("resize", updatePosition);
			window.removeEventListener("scroll", updatePosition, true);
		};
	});
	onCleanup(cancelTimer);
	return (
		<span
			ref={(element) => {
				anchor = element;
			}}
			{...stylex.attrs(styles.anchor, disabled() && styles.anchorDisabled)}
			onPointerEnter={() => show(300)}
			onPointerLeave={leave}
			onPointerDown={() => {
				pressed = true;
			}}
			onPointerUp={() => {
				pressed = false;
			}}
			onFocusIn={(event) => {
				// Pointer presses and focus returning from a closed menu are not keyboard visits.
				const fromPointer = pressed;
				pressed = false;
				if (fromPointer || isReturningFocus(event.target)) return;
				show(0, true);
			}}
			onFocusOut={close}
			onKeyDown={(event) => {
				// The focused tool dismisses its own tooltip before an enclosing menu sees Escape.
				if (event.key !== "Escape" || event.defaultPrevented || !open()) return;
				event.preventDefault();
				close();
			}}
			onClick={close}
		>
			<button
				type="button"
				{...buttonProps}
				aria-label={accessibleName()}
				aria-describedby={open() ? id : undefined}
				{...stylex.attrs(
					styles.button,
					props.showLabel && styles.labelled,
					selected() && styles.selected,
					// Disabled controls receive no pointer events in Chromium, so the anchor takes
					// the hover that explains why the tool is unavailable.
					disabled() && styles.disabled
				)}
			>
				{props.children}
				<Show when={props.showLabel}>
					<span>{props.label}</span>
				</Show>
				<Show when={!props.showLabel && props["aria-pressed"] === "true"}>
					<span aria-hidden="true" {...stylex.attrs(styles.check)}>
						✓
					</span>
				</Show>
				<Show when={props.badge !== undefined}>
					<span
						aria-hidden="true"
						{...stylex.attrs(styles.badge, props.showLabel && styles.badgeInline)}
					>
						{props.badge}
					</span>
				</Show>
			</button>
			<Show when={open()}>
				<Portal>
					<div
						id={id}
						role="tooltip"
						ref={(element) => {
							tooltip = element;
						}}
						{...stylex.attrs(styles.tooltip(position().left, position().top))}
					>
						<Show when={!props.showLabel}>
							<strong>{props.label}</strong>
						</Show>
						<Show when={props.tooltip}>
							<span>{props.tooltip}</span>
						</Show>
					</div>
				</Portal>
			</Show>
		</span>
	);
}

const styles = stylex.create({
	anchor: { display: "inline-flex", flexShrink: 0 },
	anchorDisabled: { cursor: "not-allowed" },
	button: {
		position: "relative",
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		flexShrink: 0,
		boxSizing: "border-box",
		width: 30,
		height: 30,
		padding: 0,
		borderWidth: 0,
		borderRadius: tokens.radiusControl,
		backgroundColor: { default: "transparent", ":hover": tokens.colorSurfaceHover },
		color: tokens.colorTextMuted,
		cursor: { default: "pointer", ":disabled": "not-allowed" },
		opacity: { default: 1, ":disabled": 0.42 },
		":focus-visible": { outline: `2px solid ${tokens.colorAccent}`, outlineOffset: 1 }
	},
	labelled: {
		gap: 6,
		width: "auto",
		paddingInline: 8,
		fontFamily: tokens.fontBody,
		fontSize: 12,
		lineHeight: "16px",
		whiteSpace: "nowrap"
	},
	disabled: { pointerEvents: "none" },
	selected: {
		backgroundColor: tokens.colorAccentWash,
		color: tokens.colorAccent,
		boxShadow: `inset 0 -2px 0 ${tokens.colorAccent}`
	},
	check: {
		position: "absolute",
		bottom: 2,
		right: 2,
		fontSize: 9,
		lineHeight: "9px",
		backgroundColor: tokens.colorSurface,
		borderRadius: 2
	},
	badge: {
		position: "absolute",
		top: -2,
		right: -3,
		minWidth: 10,
		padding: "0 2px",
		borderRadius: tokens.radiusControl,
		backgroundColor: tokens.colorSurfaceRaised,
		color: tokens.colorAccent,
		fontSize: 10,
		lineHeight: "12px",
		fontFamily: tokens.fontBody
	},
	badgeInline: {
		position: "static",
		minWidth: 0,
		padding: 0,
		backgroundColor: "transparent",
		fontSize: 11
	},
	tooltip: (left: number, top: number) => ({
		position: "fixed",
		left,
		top,
		zIndex: 100,
		pointerEvents: "none",
		display: "grid",
		gap: 4,
		maxWidth: "min(280px, calc(100vw - 16px))",
		boxSizing: "border-box",
		padding: "8px 10px",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: tokens.colorBorderStrong,
		borderRadius: tokens.radiusControl,
		backgroundColor: tokens.colorSurfaceRaised,
		color: tokens.colorText,
		fontFamily: tokens.fontBody,
		fontSize: 12,
		lineHeight: 1.4,
		boxShadow: "0 4px 16px rgba(0, 0, 0, 0.35)"
	})
});
