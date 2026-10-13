import * as stylex from "@stylexjs/stylex";
import type { EditorAssetLocateResult } from "@ue-shed/protocol";
import { Button, createEffectAction } from "@ue-shed/ui";
import { Effect } from "effect";
import { Show, createEffect, createSignal } from "solid-js";
import type { GameTextClientApi } from "./game-text-client.js";
import { styles } from "./game-text-styles.js";

type LocateFeedback =
	| { readonly status: "idle" }
	| { readonly status: "locating" }
	| EditorAssetLocateResult
	| { readonly status: "failed"; readonly message: string; readonly recovery: string };

function message(feedback: LocateFeedback): string | undefined {
	if (feedback.status === "idle") return undefined;
	if (feedback.status === "locating") return "Opening the asset in Unreal…";
	if (feedback.status === "located") return "Shown in Unreal’s Content Browser.";
	return "Couldn’t show the asset. " + feedback.message + " " + feedback.recovery;
}

/** Navigation success is reported only after the editor confirms the requested asset. */
export function ShowInUnrealButton(props: {
	readonly client: Pick<GameTextClientApi, "locateAsset">;
	readonly objectPath: string;
}) {
	const action = createEffectAction();
	const [feedback, setFeedback] = createSignal<LocateFeedback>({ status: "idle" });
	createEffect(
		() => props.objectPath,
		() => {
			action.cancel();
			setFeedback({ status: "idle" });
		}
	);
	return (
		<div {...stylex.attrs(styles.smallAction)}>
			<Button
				type="button"
				size="compact"
				title={props.objectPath}
				disabled={feedback().status === "locating"}
				onClick={() => {
					const objectPath = props.objectPath;
					setFeedback({ status: "locating" });
					action.run(props.client.locateAsset(objectPath), {
						onSuccess: (result) => {
							setFeedback(
								result.objectPath === objectPath
									? result
									: {
											status: "failed",
											message: "Unreal returned a different asset.",
											recovery: "Retry showing this asset."
										}
							);
							// Success is said once; the button is ready to use again.
							if (result.status === "located" && result.objectPath === objectPath)
								action.run(Effect.sleep("4 seconds"), {
									onSuccess: () => setFeedback({ status: "idle" })
								});
						},
						onFailure: () =>
							setFeedback({
								status: "failed",
								message: "Unreal did not answer.",
								recovery: "Check the editor connection and retry showing the asset."
							})
					});
				}}
			>
				{feedback().status === "locating" ? "Opening…" : "Show in Unreal"}
			</Button>
			<Show when={message(feedback())}>
				{(detail) => (
					<span
						role="status"
						{...stylex.attrs(
							styles.muted,
							(feedback().status === "unavailable" ||
								feedback().status === "failed") &&
								styles.warning
						)}
					>
						{detail()}
					</span>
				)}
			</Show>
		</div>
	);
}
