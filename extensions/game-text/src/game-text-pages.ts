import type { TextCorpusSearchPage } from "@ue-shed/game-text/browser";

/** A further page appended to the rows already loaded; counts and cursors come from the newer. */
export function mergePages(
	loaded: TextCorpusSearchPage,
	next: TextCorpusSearchPage
): TextCorpusSearchPage {
	return {
		...next,
		units: [...loaded.units, ...next.units],
		...(loaded.localization && next.localization
			? {
					localization: {
						...next.localization,
						lines: [...loaded.localization.lines, ...next.localization.lines]
					}
				}
			: undefined)
	};
}

/** The cursor that loads the page after this one, if there is one. */
export function nextPageCursor(page: TextCorpusSearchPage) {
	return page.localization?.nextCursor
		? { localizationCursor: page.localization.nextCursor }
		: page.nextCursor
			? { cursor: page.nextCursor }
			: undefined;
}

/** How many rows a page holds: its lines with a localization target, else its units. */
export function pageRows(page: TextCorpusSearchPage) {
	return page.localization?.lines.length ?? page.units.length;
}
