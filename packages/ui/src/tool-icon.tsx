import type { JSX } from "@solidjs/web";

export type ToolIconName =
	| "text"
	| "checks"
	| "reports"
	| "filter"
	| "display"
	| "panel"
	| "reviewed"
	| "proofread"
	| "approved"
	| "machine"
	| "refresh"
	| "export"
	| "presets"
	| "files"
	| "translations";

/** Small stroke icons matching the Workbench navigation, usable by any host. */
export function ToolIcon(props: { readonly name: ToolIconName }): JSX.Element {
	const paths = {
		text: "M3 3.5h10M8 3.5v9M5.5 12.5h5",
		checks: "M3 3.5h5M3 7h4M3 10.5h3M8 10l2 2 4-5",
		reports: "M2.5 13.5h11M4 11V8M8 11V3M12 11V6",
		filter: "M2 3h12L9.5 8v4l-3 1V8Z",
		display: "M2 4h12M2 8h12M2 12h12M5 2.5v3M11 6.5v3M6 10.5v3",
		panel: "M2.5 2.5h11v11h-11ZM9 2.5v11M11 5v6",
		reviewed: "M3 3h10v10H3ZM5 8l2 2 4-4",
		proofread: "M2 10l3-7 3 7M3 8h4M9 7l1.5 1.5L14 5M2 13h12",
		approved:
			"M8 2l2 1 2.5.5.5 2.5 1 2-1 2-.5 2.5-2.5.5-2 1-2-1-2.5-.5L3 10 2 8l1-2 .5-2.5L6 3ZM5.5 8l1.5 1.5 3.5-3.5",
		machine: "M4 4h8v8H4ZM6 6h4v4H6ZM6 1v3M10 1v3M6 12v3M10 12v3M1 6h3M1 10h3M12 6h3M12 10h3",
		refresh: "M13 6a5 5 0 0 0-9-2L2 6M2 2v4h4M3 10a5 5 0 0 0 9 2l2-2M10 10h4v4",
		export: "M8 2v8M5 7l3 3 3-3M3 10v3h10v-3",
		presets: "M4 2.5h8v11L8 11l-4 2.5Z",
		files: "M6 1.5h5l3 3v7H6ZM11 1.5v3h3M3 4.5H2v10h8v-1",
		translations: "M1.5 3h7M5 1.5V3M3 3c0 3 2 5 5 6M7 3c0 3-2 5-5 6M8 13l3-7 3 7M9 11h4"
	} satisfies Record<ToolIconName, string>;
	return (
		<svg
			aria-hidden="true"
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			stroke-width="1.4"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d={paths[props.name]} />
		</svg>
	);
}
