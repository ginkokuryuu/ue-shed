// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { userEvent } from "@testing-library/user-event";
import { LocalizationEdit } from "@ue-shed/game-text/browser";
import { EffectRuntimeProvider } from "@ue-shed/ui";
import { Layer, ManagedRuntime, Schema } from "effect";
import { afterAll, afterEach, expect, it } from "vitest";
import {
	createGameTextEdits,
	StagedEditsButton,
	StagedEditsPanel
} from "./game-text-translation-edits.js";

const runtime = ManagedRuntime.make(Layer.empty);
afterAll(() => runtime.dispose());
afterEach(cleanup);

it("keeps 45 drafts available after closing the scrollable review", async () => {
	function Review() {
		const model = createGameTextEdits({
			client: {},
			target: () => undefined,
			nativeCulture: () => "en",
			busy: () => false,
			onWritten: () => {
				throw new Error("This test never writes translations");
			}
		});
		const stage = () => {
			model.stageAll(
				Array.from({ length: 45 }, (_, index) => ({
					edit: Schema.decodeUnknownSync(LocalizationEdit)({
						culture: "fr",
						namespace: "UI",
						key: `Line${index}`,
						seenTranslation: null,
						translation: `Translation ${index}`
					}),
					source: `Source ${index}`
				}))
			);
			model.setOpen(true);
		};
		return (
			<>
				<button onClick={stage}>Stage 45 drafts</button>
				<StagedEditsButton model={model} />
				<StagedEditsPanel model={model} />
			</>
		);
	}
	// The panel only needs the edit methods; no scan or filesystem capability is invoked.
	render(() => (
		<EffectRuntimeProvider runtime={runtime}>
			<Review />
		</EffectRuntimeProvider>
	));
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Stage 45 drafts" }));
	const panel = screen.getByRole("region", { name: "Staged translations" });
	const changes = within(panel).getByRole("region", { name: "Staged translation changes" });
	expect(changes.getAttribute("tabindex")).toBe("0");
	expect(within(changes).getAllByRole("button", { name: "Unstage" })).toHaveLength(45);
	expect(within(panel).getByRole("button", { name: "Write to PO" })).toHaveProperty(
		"disabled",
		true
	);
	await user.click(within(panel).getByRole("button", { name: "Close staged translations" }));
	expect(screen.queryByRole("region", { name: "Staged translations" })).toBeNull();
	await user.click(screen.getByRole("button", { name: "45 staged" }));
	expect(screen.getAllByRole("button", { name: "Unstage" })).toHaveLength(45);
	expect(screen.getByText("Translation 44")).toBeDefined();
});
