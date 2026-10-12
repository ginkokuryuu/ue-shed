import * as stylex from "@stylexjs/stylex";
import { tokens } from "@ue-shed/ui-theme/tokens.stylex.js";
import { Show } from "solid-js";

/** A measured stage gets a compact bar; unknown totals use an activity spinner beside the readout. */
export function GameTextScanProgress(props: {
	readonly label: string;
	readonly completed: number;
	readonly total: number;
}) {
	const known = () => props.total > 0;
	const percent = () => Math.min(100, Math.max(0, (props.completed / props.total) * 100));
	return (
		<Show
			when={known()}
			fallback={
				<span
					aria-hidden="true"
					data-scan-activity="true"
					{...stylex.attrs(styles.activity)}
				/>
			}
		>
			<span
				role="progressbar"
				aria-label={props.label}
				aria-valuemin={0}
				aria-valuenow={known() ? props.completed : undefined}
				aria-valuemax={known() ? props.total : undefined}
				{...stylex.attrs(styles.track)}
			>
				<span
					{...stylex.attrs(styles.fill)}
					style={known() ? { width: `${percent()}%` } : undefined}
				/>
			</span>
		</Show>
	);
}

const styles = stylex.create({
	track: {
		display: "inline-block",
		flexShrink: 0,
		width: 120,
		height: 6,
		borderRadius: tokens.radiusControl,
		pointerEvents: "none",
		overflow: "hidden",
		backgroundColor: tokens.colorSurfaceHover
	},
	fill: { display: "block", height: "100%", backgroundColor: tokens.colorAccent },
	activity: {
		display: "inline-block",
		flexShrink: 0,
		width: 10,
		height: 10,
		borderWidth: 2,
		borderStyle: "solid",
		borderColor: tokens.colorBorderStrong,
		borderTopColor: tokens.colorAccent,
		borderRadius: "50%",
		animationName: stylex.keyframes({ to: { transform: "rotate(360deg)" } }),
		animationPlayState: {
			default: "running",
			"@media (prefers-reduced-motion: reduce)": "paused"
		},
		animationDuration: "700ms",
		animationIterationCount: "infinite",
		animationTimingFunction: "linear"
	}
});
