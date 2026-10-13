const candidates =
	'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]:not([contenteditable="false"])';

const quietFocus = new WeakSet<Element>();

/** Whether the element is rendered and not hidden or inert. */
export function isRendered(element: HTMLElement): boolean {
	if (element.closest("[hidden], [inert]")) return false;
	// jsdom has no layout; browsers also exclude display:none and visibility:hidden ancestors.
	if ("checkVisibility" in element) return element.checkVisibility({ visibilityProperty: true });
	return true;
}

/** Whether keyboard Tab can reach the element: enabled, in the tab order and rendered. */
export function isTabbable(element: HTMLElement): boolean {
	if (element.tabIndex < 0) return false;
	if ("disabled" in element && element.disabled === true) return false;
	return isRendered(element);
}

/** Tabbable descendants of a root in document order. */
export function tabbableWithin(root: ParentNode): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>(candidates)).filter(isTabbable);
}

/** Text-editing controls own caret keys such as Home, End and the horizontal arrows. */
export function isTextEditable(element: Element): boolean {
	if (element instanceof HTMLTextAreaElement) return true;
	if (element instanceof HTMLElement && element.isContentEditable) return true;
	return (
		element instanceof HTMLInputElement &&
		["", "text", "search", "email", "url", "tel", "password", "number"].includes(element.type)
	);
}

/**
 * Returns focus to an element without treating it as a fresh visit, so a tooltip does not reopen
 * when a menu it launched closes.
 */
export function returnFocus(element: HTMLElement): void {
	quietFocus.add(element);
	try {
		element.focus();
	} finally {
		quietFocus.delete(element);
	}
}

/** Whether focus is arriving through {@link returnFocus}. */
export function isReturningFocus(element: Element): boolean {
	return quietFocus.has(element);
}
