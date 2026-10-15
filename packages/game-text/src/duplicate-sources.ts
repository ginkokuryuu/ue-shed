import type { TextOccurrence } from "./schema.js";
import { textFileKey, normalizeTextPath } from "./text-origin.js";
import { manifestPlace } from "./localization-key-changes.js";

/** Counts counterparts outside both the current identity and the current saved place. */
export class DuplicateSources<S, I, P> {
	private readonly sources = new Map<
		S,
		{
			count: number;
			identities: Map<I, number>;
			places: Map<P, number>;
			pairs: Map<I, Map<P, number>>;
		}
	>();
	add(source: S, identity: I, place: P) {
		let group = this.sources.get(source);
		if (!group) {
			group = { count: 0, identities: new Map(), places: new Map(), pairs: new Map() };
			this.sources.set(source, group);
		}
		group.count++;
		group.identities.set(identity, (group.identities.get(identity) ?? 0) + 1);
		group.places.set(place, (group.places.get(place) ?? 0) + 1);
		let pair = group.pairs.get(identity);
		if (!pair) {
			pair = new Map();
			group.pairs.set(identity, pair);
		}
		pair.set(place, (pair.get(place) ?? 0) + 1);
	}
	hasOther(source: S, identity: I, place: P): boolean {
		const group = this.sources.get(source);
		return (
			group !== undefined &&
			group.count -
				(group.identities.get(identity) ?? 0) -
				(group.places.get(place) ?? 0) +
				(group.pairs.get(identity)?.get(place) ?? 0) >
				0
		);
	}
}

/** Same package, object and field, including the DataTable row or String Table entry. */
export function duplicateOccurrencePlace(
	occurrence: Pick<TextOccurrence, "packageFile" | "location">
): string {
	const location = occurrence.location;
	// String Table entry keys are case-sensitive strings, unlike object/property FNames.
	if (location.kind === "string_table_entry")
		return JSON.stringify([
			textFileKey(occurrence.packageFile),
			normalizeTextPath(location.objectPath),
			location.entryKey
		]);
	const path =
		location.kind === "data_table_cell"
			? `${location.objectPath}.${location.row}.${location.propertyPath}`
			: `${location.objectPath}.${location.propertyPath}`;
	return JSON.stringify([textFileKey(occurrence.packageFile), manifestPlace(path) ?? path]);
}

export function duplicateManifestPlace(path: string): string | undefined {
	const place = manifestPlace(path);
	return place === undefined ? undefined : JSON.stringify([textFileKey(path), place]);
}
