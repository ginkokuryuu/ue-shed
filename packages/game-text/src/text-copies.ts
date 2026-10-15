import type { TextCopyKind } from "./schema.js";

/**
 * Copies the game runs: the generated class (and the animation instances in it) and the class
 * default object. A skeleton class only serves the editor while the Blueprint compiles.
 */
export const RUNTIME_COPY_KINDS: readonly TextCopyKind[] = [
	"generated_class",
	"instance",
	"class_default"
];

/**
 * The first copy the game runs whose text differs from its place: the Blueprint was edited since
 * it compiled, and the game shows the copy's text. A skeleton copy with other text is not this.
 */
export function staleRuntimeCopy<
	C extends { readonly kind: TextCopyKind; readonly source: string }
>(occurrence: {
	readonly source: string;
	readonly copies?: readonly C[] | undefined;
}): C | undefined {
	return occurrence.copies?.find(
		(copy) => copy.source !== occurrence.source && RUNTIME_COPY_KINDS.includes(copy.kind)
	);
}

/** True when the game shows other text than the place's: see `staleRuntimeCopy`. */
export function hasDifferingCopy(occurrence: {
	readonly source: string;
	readonly copies?:
		| readonly { readonly kind: TextCopyKind; readonly source: string }[]
		| undefined;
}): boolean {
	return staleRuntimeCopy(occurrence) !== undefined;
}
