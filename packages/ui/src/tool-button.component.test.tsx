import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { userEvent } from "@testing-library/user-event";
import { createSignal } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { AnchoredPopover } from "./anchored-popover.js";
import { ToolButton } from "./tool-button.js";
import { ToolIcon } from "./tool-icon.js";

afterEach(cleanup);

it("labels an icon tool and shows a dismissible tooltip on keyboard focus", async () => {
	render(() => (
		<>
			<ToolButton label="Filter" tooltip="Narrow lines by state or location.">
				<ToolIcon name="filter" />
			</ToolButton>
			<button type="button">Next</button>
		</>
	));
	const user = userEvent.setup();
	const tool = screen.getByRole("button", { name: "Filter" });
	expect(tool.textContent).toBe("");
	await user.tab();
	expect(document.activeElement).toBe(tool);
	const tooltip = await screen.findByRole("tooltip");
	expect(tooltip.textContent).toContain("Narrow lines by state or location.");
	expect(tool.getAttribute("aria-describedby")).toBe(tooltip.id);
	expect(tooltip.parentElement).toBe(document.body);
	await user.keyboard("{Escape}");
	expect(screen.queryByRole("tooltip")).toBeNull();
	expect(document.activeElement).toBe(tool);
	await user.tab();
	expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next" }));
});

it("keeps a hovered tooltip available while the pointer enters it", async () => {
	render(() => (
		<ToolButton label="Display" tooltip="Change list grouping.">
			<ToolIcon name="display" />
		</ToolButton>
	));
	const user = userEvent.setup();
	await user.hover(screen.getByRole("button", { name: "Display" }));
	const tooltip = await screen.findByRole("tooltip");
	await user.hover(tooltip);
	expect(screen.getByRole("tooltip")).toBe(tooltip);
	await user.unhover(tooltip);
	await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
});

it("exposes toggle state and changes its tooltip after the tool is used", async () => {
	render(() => {
		const [reviewed, setReviewed] = createSignal(false);
		return (
			<ToolButton
				label="Reviewed"
				tooltip={
					reviewed() ? "On. Remove the review flag." : "Off. Mark this text reviewed."
				}
				aria-pressed={reviewed() ? "true" : "false"}
				onClick={() => setReviewed(!reviewed())}
			>
				<ToolIcon name="reviewed" />
			</ToolButton>
		);
	});
	const tool = screen.getByRole("button", { name: "Reviewed", pressed: false });
	await userEvent.setup().click(tool);
	expect(tool.getAttribute("aria-pressed")).toBe("true");
	// Clicking dismisses the tooltip; leaving and returning reveals the new state.
	fireEvent.blur(tool);
	fireEvent.focusIn(tool);
	expect((await screen.findByRole("tooltip")).textContent).toContain("On. Remove");
});

it("forwards a popover's trigger ref and restores keyboard focus when its menu closes", async () => {
	render(() => (
		<AnchoredPopover
			id="tool-menu"
			ariaLabel="Display options"
			trigger={(trigger) => (
				<ToolButton {...trigger} label="Display" tooltip="Change list grouping.">
					<ToolIcon name="display" />
				</ToolButton>
			)}
		>
			<button type="button">Folder</button>
		</AnchoredPopover>
	));
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Display" }));
	await screen.findByRole("dialog", { name: "Display options" });
	expect(screen.queryByRole("tooltip")).toBeNull();
	await waitFor(() =>
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "Folder" }))
	);
	await user.keyboard("{Escape}");
	await waitFor(() =>
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "Display" }))
	);
});
