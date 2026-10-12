import * as stylex from "@stylexjs/stylex";
import { tokens } from "@ue-shed/ui-theme/tokens.stylex.js";

/** Fits inside the toolbar edge; unknown totals animate without claiming a percentage. */
export function GameTextScanProgress(props: {
	readonly label: string;
	readonly completed: number;
	readonly total: number;
}) {
	const known = () => props.total > 0;
	const percent = () => Math.min(100, Math.max(0, (props.completed / props.total) * 100));
	return (
		<div
			role="progressbar"
			aria-label={props.label}
			aria-valuemin={0}
			aria-valuenow={known() ? props.completed : undefined}
			aria-valuemax={known() ? props.total : undefined}
			{...stylex.attrs(styles.track)}
		>
			<span
				{...(known()
					? stylex.attrs(styles.fill)
					: stylex.attrs(styles.fill, styles.indeterminate))}
				style={known() ? { width: `${percent()}%` } : undefined}
			/>
		</div>
	);
}

const styles = stylex.create({
	track: {
		position: "absolute",
		bottom: 0,
		left: 0,
		width: "100%",
		height: 4,
		pointerEvents: "none",
		overflow: "hidden",
		backgroundColor: tokens.colorSurfaceHover
	},
	fill: { display: "block", height: "100%", backgroundColor: tokens.colorAccent },
	indeterminate: {
		width: { default: "32%", "@media (prefers-reduced-motion: reduce)": "100%" },
		animationName: stylex.keyframes({
			from: { transform: "translateX(0)" },
			to: { transform: "translateX(320%)" }
		}),
		animationPlayState: {
			default: "running",
			"@media (prefers-reduced-motion: reduce)": "paused"
		},
		animationDuration: "1200ms",
		animationIterationCount: "infinite",
		animationTimingFunction: "ease-in-out",
		opacity: { default: 1, "@media (prefers-reduced-motion: reduce)": 0.6 }
	}
});
