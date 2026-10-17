import * as stylex from "@stylexjs/stylex";
import { textCountLabel } from "@ue-shed/game-text/labels";
import { type TextCorpusDiagnostic, type TextCorpusQuerySummary } from "@ue-shed/game-text/schema";
import { AnchoredPopover } from "@ue-shed/ui";
import { For, Show, createUniqueId } from "solid-js";
import { styles } from "./game-text-styles.js";

const diagnosticLabels = {
	package_inspection_failed: "Asset could not be read",
	package_partially_decoded: "Asset not fully read",
	unsupported_text_history: "Text field not decoded",
	package_not_gatherable: "Excluded because Unreal does not gather it",
	gatherable_text_not_decoded: "Gathered text not read"
};

/**
 * Scan-wide coverage stays available from either view without a summary strip. It only appears
 * when text Unreal gathers may be missing: excluded assets match Unreal's gather, and properties
 * that hold no gatherable text are not a coverage problem.
 */
export function ReadProblems(props: { readonly summary: TextCorpusQuerySummary }) {
	const id = createUniqueId();
	const unread = () =>
		props.summary.coverage.partialPackages + props.summary.coverage.failedPackages;
	const missing = () => props.summary.coverage.missingGatherableText ?? 0;
	const excluded = () => props.summary.notGatherablePackages ?? 0;
	const label = () =>
		missing() > 0
			? textCountLabel(missing(), "line") + " not read"
			: textCountLabel(unread(), "asset") + " not fully read";
	return (
		<Show when={props.summary.status === "partial"}>
			{" · "}
			<AnchoredPopover
				id={id}
				ariaLabel="Read problems"
				placement="bottom-end"
				style={styles.readProblems}
				trigger={(triggerProps) => (
					<button
						{...triggerProps}
						type="button"
						aria-label="Read problems"
						title="Inspect text Unreal gathers that the scan could not read."
						{...stylex.attrs(styles.readProblemsTrigger)}
					>
						{label()}
					</button>
				)}
			>
				<p {...stylex.attrs(styles.problemMessage)}>
					{missing() > 0
						? "Some text Unreal gathers from the project's saved assets was not read. "
						: "Some of the project's saved text may not have been read. "}
					Writing checks cover the lines that were read.
				</p>
				<Show when={missing() > 0}>
					<p {...stylex.attrs(styles.problemMessage, styles.warning)}>
						{textCountLabel(missing(), "line")} listed in the assets' gather data could
						not be read.
					</p>
				</Show>
				<p {...stylex.attrs(styles.problemMessage)}>
					{props.summary.coverage.inspectedPackages.toLocaleString()} of{" "}
					{textCountLabel(props.summary.coverage.discoveredPackages, "asset")} read ·{" "}
					{textCountLabel(props.summary.coverage.partialPackages, "asset")} partly read ·{" "}
					{textCountLabel(props.summary.coverage.failedPackages, "asset")} could not be
					read
				</p>
				<Show when={excluded() > 0}>
					<p {...stylex.attrs(styles.problemMessage)}>
						{textCountLabel(excluded(), "asset")} skipped because Unreal does not gather
						them either.
					</p>
				</Show>
				<p {...stylex.attrs(styles.problemMessage)}>
					Select a line to inspect read problems for its assets under Where it appears.
				</p>
			</AnchoredPopover>
		</Show>
	);
}

export function CoverageNotes(props: { readonly diagnostics: readonly TextCorpusDiagnostic[] }) {
	return (
		<Show when={props.diagnostics.length > 0}>
			<section
				aria-label="Read problems for this line"
				{...stylex.attrs(styles.detailSection)}
			>
				<h3 {...stylex.attrs(styles.section)}>Read problems</h3>
				<For each={props.diagnostics}>
					{(diagnostic) => (
						<article {...stylex.attrs(styles.card)}>
							<strong {...stylex.attrs(styles.warning)}>
								{diagnosticLabels[diagnostic.code]}
							</strong>
							<p {...stylex.attrs(styles.problemMessage)}>{diagnostic.message}</p>
							<code {...stylex.attrs(styles.mono)}>{diagnostic.packageFile}</code>
							<Show when={diagnostic.objectPath}>
								<code {...stylex.attrs(styles.mono)}>{diagnostic.objectPath}</code>
							</Show>
							<Show when={diagnostic.propertyPath}>
								<code {...stylex.attrs(styles.mono)}>
									{diagnostic.propertyPath}
								</code>
							</Show>
						</article>
					)}
				</For>
			</section>
		</Show>
	);
}
