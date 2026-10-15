import { relative, resolve } from "node:path";
import type {
	SavedAssetPackageTextEvent,
	SavedAssetTextCoverageGap,
	SavedAssetTextExtractionEvent,
	SavedAssetTextOccurrence
} from "@ue-shed/unreal-assets";

// The reader scans only the project's Content folder, which Unreal mounts at /Game.
const CONTENT_PACKAGE = /^Content\/(.+)\.(?:uasset|umap)$/iu;

/** Unreal's package name for a saved package file, or undefined outside the project's Content. */
export function mountedPackageName(projectRoot: string, path: string): string | undefined {
	const packageFile = relative(projectRoot, resolve(projectRoot, path)).replaceAll("\\", "/");
	const name = packageFile.match(CONTENT_PACKAGE)?.[1];
	return name === undefined ? undefined : `/Game/${name}`;
}

/**
 * UE 4.27 usually saves `None` as a package's own name, so the reader names the package's objects
 * relative to it: `DT_Items` or `DT_Items:Sub` rather than `/Game/Data/DT_Items.DT_Items`. Only the
 * caller knows the file, and so the package name that completes them. Unreal paths, which start
 * with `/`, and empty paths are returned unchanged.
 */
export function mountObjectPath(path: string, packageName: string | undefined): string {
	return packageName === undefined || path === "" || path.startsWith("/")
		? path
		: `${packageName}.${path}`;
}

function isPackageRelative(path: string): boolean {
	return path !== "" && !path.startsWith("/");
}

function mountOccurrence(
	occurrence: SavedAssetTextOccurrence,
	packageName: string
): SavedAssetTextOccurrence {
	const location = occurrence.location;
	if (location.kind !== "asset_property")
		return isPackageRelative(location.object_path)
			? {
					...occurrence,
					location: {
						...location,
						object_path: mountObjectPath(location.object_path, packageName)
					}
				}
			: occurrence;
	return isPackageRelative(location.object_path) || isPackageRelative(location.class_path)
		? {
				...occurrence,
				location: {
					...location,
					object_path: mountObjectPath(location.object_path, packageName),
					// A class saved in the same package, such as a Blueprint's generated class.
					class_path: mountObjectPath(location.class_path, packageName)
				}
			}
		: occurrence;
}

function mountGap(gap: SavedAssetTextCoverageGap, packageName: string): SavedAssetTextCoverageGap {
	return isPackageRelative(gap.object_path)
		? { ...gap, object_path: mountObjectPath(gap.object_path, packageName) }
		: gap;
}

/**
 * The reader's evidence with every package-relative object path completed, so the corpus and the
 * index store the paths Unreal uses, which rules, exports, key changes and String Table references
 * compare against. Events whose paths are already complete are returned as they are.
 */
export function mountPackageTextEvent(
	projectRoot: string,
	event: SavedAssetPackageTextEvent
): SavedAssetPackageTextEvent;
export function mountPackageTextEvent(
	projectRoot: string,
	event: SavedAssetPackageTextEvent | SavedAssetTextExtractionEvent
): SavedAssetPackageTextEvent | SavedAssetTextExtractionEvent;
export function mountPackageTextEvent(
	projectRoot: string,
	event: SavedAssetPackageTextEvent | SavedAssetTextExtractionEvent
): SavedAssetPackageTextEvent | SavedAssetTextExtractionEvent {
	if (
		event.event !== "text_package_record" &&
		event.event !== "text_occurrence" &&
		event.event !== "text_coverage_gap"
	)
		return event;
	const packageName = mountedPackageName(projectRoot, event.path);
	if (packageName === undefined) return event;
	if (event.event === "text_occurrence") {
		const occurrence = mountOccurrence(event.occurrence, packageName);
		return occurrence === event.occurrence ? event : { ...event, occurrence };
	}
	if (event.event === "text_coverage_gap") {
		const gap = mountGap(event.coverage_gap, packageName);
		return gap === event.coverage_gap ? event : { ...event, coverage_gap: gap };
	}
	let changed = false;
	const occurrences = event.occurrences.map((occurrence) => {
		const mounted = mountOccurrence(occurrence, packageName);
		changed ||= mounted !== occurrence;
		return mounted;
	});
	const gapSamples = event.gapSamples.map((gap) => {
		const mounted = mountGap(gap, packageName);
		changed ||= mounted !== gap;
		return mounted;
	});
	return changed ? { ...event, occurrences, gapSamples } : event;
}
