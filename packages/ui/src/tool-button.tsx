import * as stylex from "@stylexjs/stylex";
import { Portal, type ComponentProps, type JSX } from "@solidjs/web";
import { tokens } from "@ue-shed/ui-theme/tokens.stylex.js";
import { Show, createEffect, createSignal, createUniqueId, omit, onSettled } from "solid-js";

const tooltipOpened = "ue-shed:tool-tooltip-open";

export type ToolButtonProps = Omit<
	ComponentProps<"button">,
	"class" | "style" | "title" | "aria-label" | "children"
> & {
	readonly label: string;
	readonly tooltip: string;
	readonly children: JSX.Element;
	readonly badge?: number | string | undefined;
};

/** Icon tool with a hoverable, keyboard-accessible tooltip and persistent selected state. */
export function ToolButton(props: ToolButtonProps) {
	const buttonProps = omit(props, "children", "label", "tooltip", "badge");
	const id = createUniqueId();
	const [open, setOpen] = createSignal(false);
	const [position, setPosition] = createSignal({ left: 0, top: 0 });
	let anchor: HTMLSpanElement | undefined;
	let tooltip: HTMLDivElement | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expanded = () => props["aria-expanded"] === "true";
	const selected = () =>
		expanded() || props["aria-pressed"] === "true" || props["aria-selected"] === "true";
	const cancelTimer = () => {
		clearTimeout(timer);
		timer = undefined;
	};
	const close = () => {
		cancelTimer();
		setOpen(false);
	};
	const show = (delay = 0) => {
		cancelTimer();
		if (expanded() || open()) return;
		const reveal = () => {
			anchor?.dispatchEvent(new Event(tooltipOpened, { bubbles: true }));
			setOpen(true);
		};
		if (delay) timer = setTimeout(reveal, delay);
		else reveal();
	};
	const leave = () => {
		cancelTimer();
		if (anchor?.contains(document.activeElement)) return;
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
	createEffect(open, (value) => {
		if (!value) return;
		const frame = requestAnimationFrame(updatePosition);
		window.addEventListener("resize", updatePosition);
		window.addEventListener("scroll", updatePosition, true);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("resize", updatePosition);
			window.removeEventListener("scroll", updatePosition, true);
		};
	});
	onSettled(() => {
		const dismissOther = (event: Event) => {
			if (event.target !== anchor) close();
		};
		const escape = (event: KeyboardEvent) => {
			if (event.key === "Escape" && open()) {
				event.preventDefault();
				close();
			}
		};
		document.addEventListener("keydown", escape);
		document.addEventListener(tooltipOpened, dismissOther);
		return () => {
			cancelTimer();
			document.removeEventListener("keydown", escape);
			document.removeEventListener(tooltipOpened, dismissOther);
		};
	});
	return (
		<span
			ref={(element) => {
				anchor = element;
			}}
			{...stylex.attrs(styles.anchor)}
			onPointerEnter={() => show(300)}
			onPointerLeave={leave}
			onFocusIn={() => show()}
			onFocusOut={close}
			onClick={close}
		>
			<button
				type="button"
				{...buttonProps}
				aria-label={props.label}
				aria-describedby={open() ? id : undefined}
				{...stylex.attrs(styles.button, selected() && styles.selected)}
			>
				{props.children}
				<Show when={props["aria-pressed"] === "true"}>
					<span aria-hidden="true" {...stylex.attrs(styles.check)}>
						✓
					</span>
				</Show>
				<Show when={props.badge !== undefined}>
					<span aria-hidden="true" {...stylex.attrs(styles.badge)}>
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
						onPointerEnter={() => show()}
						onPointerLeave={leave}
					>
						<strong>{props.label}</strong>
						<span>{props.tooltip}</span>
					</div>
				</Portal>
			</Show>
		</span>
	);
}

const styles = stylex.create({
	anchor: { display: "inline-flex", flexShrink: 0 },
	button: {
		position: "relative",
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		flexShrink: 0,
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
	tooltip: (left: number, top: number) => ({
		position: "fixed",
		left,
		top,
		zIndex: 100,
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
