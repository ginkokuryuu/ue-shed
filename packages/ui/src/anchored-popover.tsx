import * as stylex from "@stylexjs/stylex";
import { Portal, type JSX } from "@solidjs/web";
import { tokens } from "@ue-shed/ui-theme/tokens.stylex.js";
import { Show, createEffect, createSignal, onSettled } from "solid-js";
import { isRendered, isTextEditable, returnFocus, tabbableWithin } from "./focus.js";

export type AnchoredPopoverPlacement = "top-start" | "top-end" | "bottom-start" | "bottom-end";

export interface AnchoredPopoverTriggerProps {
	readonly "aria-controls": string;
	readonly "aria-expanded": "false" | "true";
	readonly "aria-haspopup": "dialog";
	readonly onClick: () => void;
	readonly ref: (element: HTMLButtonElement) => void;
}

export interface AnchoredPopoverProps {
	readonly ariaLabel: string;
	readonly children: JSX.Element;
	readonly id: string;
	readonly open?: boolean;
	readonly onOpenChange?: (open: boolean) => void;
	readonly placement?: AnchoredPopoverPlacement;
	readonly style?: stylex.StyleXStyles;
	readonly trigger: (props: AnchoredPopoverTriggerProps) => JSX.Element;
}

const viewportMargin = 8;
const anchorGap = 7;

const isSearchField = (element: Element) =>
	element instanceof HTMLInputElement && element.type === "search";

/** A portalled, light-dismiss panel positioned against a button trigger. */
export function AnchoredPopover(props: AnchoredPopoverProps) {
	const [internalOpen, setInternalOpen] = createSignal(false);
	const open = () => props.open ?? internalOpen();
	const [position, setPosition] = createSignal({ left: 0, top: 0 });
	let trigger: HTMLButtonElement | undefined;
	let panel: HTMLElement | undefined;

	const setOpenState = (next: boolean) => {
		if (open() === next) return;
		if (props.open === undefined) setInternalOpen(next);
		props.onOpenChange?.(next);
	};
	const close = (restoreFocus = false) => {
		if (!open()) return;
		setOpenState(false);
		if (restoreFocus)
			queueMicrotask(() => {
				if (trigger) returnFocus(trigger);
			});
	};
	const closeFromEscape = (event: KeyboardEvent) => {
		// Inner handlers that consume Escape (a submenu closing itself) call preventDefault or stop
		// propagation; both run before this bubble-phase check under real event ordering.
		if (event.key !== "Escape" || event.defaultPrevented || !open()) return;
		event.preventDefault();
		close(true);
	};
	const handleTab = (event: KeyboardEvent) => {
		if (!panel || !trigger) return;
		const inside = tabbableWithin(panel);
		const boundary = event.shiftKey ? inside[0] : inside.at(-1);
		if (inside.length && event.target !== boundary) return;
		event.preventDefault();
		const owner = trigger;
		const next = event.shiftKey
			? undefined
			: tabbableWithin(owner.ownerDocument).find(
					(element) =>
						!panel?.contains(element) &&
						Boolean(
							owner.compareDocumentPosition(element) &
							Node.DOCUMENT_POSITION_FOLLOWING
						) &&
						!owner.contains(element)
				);
		close();
		queueMicrotask(() => (next ? next.focus() : returnFocus(owner)));
	};
	const moveWithinMenu = (event: KeyboardEvent) => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		const vertical = event.key === "ArrowDown" || event.key === "ArrowUp";
		if (target instanceof HTMLInputElement && !isTextEditable(target)) return;
		// Text fields keep caret keys. Only a search field hands the vertical arrows to the list.
		if (isTextEditable(target) && !(vertical && isSearchField(target))) return;
		const menu = target.closest('[role="menu"]') ?? panel;
		const items = Array.from(
			menu?.querySelectorAll<HTMLElement>(
				'button:not([disabled]), input[type="radio"]:not([disabled])'
			) ?? []
		).filter(isRendered);
		if (!items.length) return;
		event.preventDefault();
		const last = items.length - 1;
		const index = items.indexOf(target);
		const step = event.key === "ArrowUp" ? -1 : 1;
		const next =
			event.key === "Home"
				? 0
				: event.key === "End"
					? last
					: index < 0
						? step < 0
							? last
							: 0
						: (index + step + items.length) % items.length;
		items[next]?.focus();
	};
	const updatePosition = () => {
		if (!trigger || !panel) return;
		const anchor = trigger.getBoundingClientRect();
		const overlay = panel.getBoundingClientRect();
		const placement = props.placement ?? "bottom-start";
		const preferredLeft = placement.endsWith("end")
			? anchor.right - overlay.width
			: anchor.left;
		const preferredTop = placement.startsWith("top")
			? anchor.top - overlay.height - anchorGap
			: anchor.bottom + anchorGap;
		const maxLeft = Math.max(
			viewportMargin,
			window.innerWidth - overlay.width - viewportMargin
		);
		const maxTop = Math.max(
			viewportMargin,
			window.innerHeight - overlay.height - viewportMargin
		);
		setPosition({
			left: Math.min(Math.max(viewportMargin, preferredLeft), maxLeft),
			top: Math.min(Math.max(viewportMargin, preferredTop), maxTop)
		});
	};

	createEffect(open, (isOpen) => {
		if (!isOpen) return;
		queueMicrotask(() => {
			if (!open() || !panel) return;
			if (panel.contains(document.activeElement)) return;
			tabbableWithin(panel)[0]?.focus();
		});
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
		const ownerDocument = trigger?.ownerDocument ?? document;
		const isWithinPopover = (event: Event) => {
			const path = event.composedPath();
			return (
				(trigger !== undefined && path.includes(trigger)) ||
				(panel !== undefined && path.includes(panel))
			);
		};
		const closeFromOutside = (event: Event) => {
			if (open() && !isWithinPopover(event)) close();
		};
		ownerDocument.addEventListener("pointerdown", closeFromOutside, true);
		ownerDocument.addEventListener("focusin", closeFromOutside, true);
		// Bubble phase: the panel's own handler and its children decide first. This fallback only
		// covers Escape while focus rests on the trigger or the page body.
		ownerDocument.addEventListener("keydown", closeFromEscape);
		return () => {
			ownerDocument.removeEventListener("pointerdown", closeFromOutside, true);
			ownerDocument.removeEventListener("focusin", closeFromOutside, true);
			ownerDocument.removeEventListener("keydown", closeFromEscape);
		};
	});

	return (
		<>
			{props.trigger({
				"aria-controls": props.id,
				get "aria-expanded"() {
					return open() ? "true" : "false";
				},
				"aria-haspopup": "dialog",
				onClick: () => setOpenState(!open()),
				ref: (element) => {
					trigger = element;
				}
			})}
			<Show when={open()}>
				<Portal>
					<section
						{...stylex.attrs(styles.panel, props.style)}
						aria-label={props.ariaLabel}
						id={props.id}
						ref={(element) => {
							panel = element;
						}}
						role="dialog"
						onKeyDown={(event) => {
							// Delegated handlers run from the target outwards, so nested menus and
							// fields have already had the chance to consume the key.
							if (event.defaultPrevented) return;
							if (event.key === "Escape") closeFromEscape(event);
							else if (event.key === "Tab") handleTab(event);
							else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
								moveWithinMenu(event);
						}}
						style={{
							left: `${position().left}px`,
							position: "fixed",
							top: `${position().top}px`
						}}
					>
						{props.children}
					</section>
				</Portal>
			</Show>
		</>
	);
}

const styles = stylex.create({
	panel: {
		fontFamily: tokens.fontBody,
		fontFeatureSettings: '"cv01", "ss03", "zero"',
		lineHeight: 1.5
	}
});
