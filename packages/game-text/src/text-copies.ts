/** True when a copy holds other text than its place: the Blueprint was edited since it compiled. */
export function hasDifferingCopy(occurrence: {
	readonly source: string;
	readonly copies?: readonly { readonly source: string }[] | undefined;
}): boolean {
	return occurrence.copies?.some((copy) => copy.source !== occurrence.source) ?? false;
}
