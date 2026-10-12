import { AnchoredPopover, Button, ToolButton, ToolIcon, type ToolIconName } from "@ue-shed/ui";
import { For, Show, createEffect, createSignal, createUniqueId } from "solid-js";
import { styles } from "./game-text-styles.js";

/** Uses the same light-dismiss popover as Export, with keyboard focus on the choices. */
export function LocalizationPicker(props: {
	readonly label: string;
	readonly value: string;
	readonly values: readonly string[];
	readonly disabled?: boolean;
	readonly reason?: string | undefined;
	readonly icon?: ToolIconName;
	readonly tooltip?: string;
	readonly onSelect: (value: string) => void;
}) {
	const id = createUniqueId();
	const [open, setOpen] = createSignal(false);
	createEffect(
		() => props.disabled,
		(disabled) => {
			if (disabled) setOpen(false);
		}
	);
	let anchor: HTMLButtonElement | undefined;
	return (
		<AnchoredPopover
			id={id}
			ariaLabel={props.label + " choices"}
			open={open()}
			onOpenChange={setOpen}
			placement="bottom-start"
			style={styles.pickerMenu}
			trigger={(trigger) => {
				const ref = (element: HTMLButtonElement) => {
					anchor = element;
					trigger.ref(element);
				};
				const click = () => {
					const wasOpen = open();
					trigger.onClick();
					if (!wasOpen)
						queueMicrotask(() => {
							const panel = anchor?.ownerDocument.getElementById(id);
							(
								panel?.querySelector<HTMLButtonElement>(
									'button[aria-pressed="true"]'
								) ?? panel?.querySelector<HTMLButtonElement>("button")
							)?.focus();
						});
				};
				return (
					<Show
						when={props.icon}
						fallback={
							<Button
								{...trigger}
								type="button"
								size="compact"
								tone="quiet"
								aria-label={props.label + ": " + props.value}
								disabled={props.disabled}
								title={props.reason}
								ref={ref}
								onClick={click}
							>
								{props.value} <span aria-hidden="true">▾</span>
							</Button>
						}
					>
						{(icon) => (
							<ToolButton
								{...trigger}
								label={props.label + ": " + props.value}
								tooltip={
									props.reason ??
									props.tooltip ??
									"Choose " + props.label.toLowerCase() + "."
								}
								disabled={props.disabled}
								ref={ref}
								onClick={click}
							>
								<ToolIcon name={icon()} />
							</ToolButton>
						)}
					</Show>
				);
			}}
		>
			<For each={props.values}>
				{(value) => (
					<Button
						type="button"
						size="compact"
						tone="quiet"
						disabled={props.disabled}
						aria-pressed={props.value === value ? "true" : "false"}
						onClick={() => {
							if (props.disabled) return;
							setOpen(false);
							props.onSelect(value);
							queueMicrotask(() => anchor?.focus());
						}}
						onKeyDown={(event) => {
							if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
								return;
							event.preventDefault();
							const buttons = Array.from(
								event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
									"button"
								) ?? []
							);
							const current = buttons.indexOf(event.currentTarget);
							const next =
								event.key === "Home"
									? 0
									: event.key === "End"
										? buttons.length - 1
										: (current +
												(event.key === "ArrowDown" ? 1 : -1) +
												buttons.length) %
											buttons.length;
							buttons[next]?.focus();
						}}
					>
						<Show when={props.value === value}>
							<span aria-hidden="true">✓</span>
						</Show>
						{value}
					</Button>
				)}
			</For>
		</AnchoredPopover>
	);
}
