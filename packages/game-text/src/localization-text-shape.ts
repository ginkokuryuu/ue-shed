/**
 * Pure text measurements behind the built-in shape and source checks. Each works on one string or
 * one source/translation pair, so in-memory and indexed scans share them line by line.
 */

/** Opening and self-closing Slate rich-text tags: `<b>`, `<Name attr="x">`, `<img id="x"/>`. */
const TAG = /<([A-Za-z_][A-Za-z0-9_.-]*)(?:\s[^<>]*)?\/?>/gu;
const CLOSING_TAG = /<\/>/gu;

/** Tag names in order of appearance; closing `</>` tags have no name and are not listed. */
export function richTextTagNames(text: string): string[] {
	if (!text.includes("<")) return [];
	return Array.from(text.matchAll(TAG), (match) => match[1]!);
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Tags compared without case: `missing` and `added` name tags whose count differs (in the
 * source's and translation's spelling), `changed` pairs a source spelling with a different-case
 * translation spelling. Undefined when neither side has tags.
 */
export function compareRichTextTags(source: string, translation: string) {
	const sourceTags = richTextTagNames(source),
		translationTags = richTextTagNames(translation);
	if (sourceTags.length === 0 && translationTags.length === 0) return undefined;
	const groups = new Map<
		string,
		{ source: Map<string, number>; translation: Map<string, number> }
	>();
	const add = (name: string, side: "source" | "translation") => {
		const lower = name.toLowerCase();
		let group = groups.get(lower);
		if (!group) groups.set(lower, (group = { source: new Map(), translation: new Map() }));
		group[side].set(name, (group[side].get(name) ?? 0) + 1);
	};
	for (const name of sourceTags) add(name, "source");
	for (const name of translationTags) add(name, "translation");
	const total = (counts: Map<string, number>) => {
		let sum = 0;
		for (const count of counts.values()) sum += count;
		return sum;
	};
	const missing: string[] = [],
		added: string[] = [],
		changed: Array<{ source: string; translation: string }> = [];
	for (const group of groups.values()) {
		const sourceForms = [...group.source.keys()].sort(byCodeUnit),
			translationForms = [...group.translation.keys()].sort(byCodeUnit);
		const sourceCount = total(group.source),
			translationCount = total(group.translation);
		if (sourceCount > translationCount) missing.push(sourceForms[0]!);
		if (translationCount > sourceCount) added.push(translationForms[0]!);
		if (sourceCount > 0)
			for (const form of translationForms)
				if (!group.source.has(form))
					changed.push({ source: sourceForms[0]!, translation: form });
	}
	return {
		sourceTags: [...new Set(sourceTags)].sort(byCodeUnit),
		translationTags: [...new Set(translationTags)].sort(byCodeUnit),
		missing: missing.sort(byCodeUnit),
		added: added.sort(byCodeUnit),
		changed: changed.sort(
			(a, b) => byCodeUnit(a.source, b.source) || byCodeUnit(a.translation, b.translation)
		)
	};
}

/** Opening tags (named, not self-closing) and `</>` closings, for source markup balance. */
export function richTextTagBalance(text: string) {
	if (!text.includes("<")) return { opening: 0, closing: 0 };
	let opening = 0;
	for (const match of text.matchAll(TAG))
		if (!match[0].endsWith("/>") && match[1]!.toLowerCase() !== "br") opening++;
	return { opening, closing: [...text.matchAll(CLOSING_TAG)].length };
}

/** Format-pattern braces that Unreal's backtick does not escape. */
export function formatBraceBalance(text: string) {
	let opening = 0,
		closing = 0;
	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		if (char === "`") index++;
		else if (char === "{") opening++;
		else if (char === "}") closing++;
	}
	return { opening, closing };
}

/** Non-overlapping occurrences of `separator`. */
export function countOccurrences(text: string, separator: string): number {
	if (separator.length === 0) return 0;
	let count = 0,
		index = text.indexOf(separator);
	while (index >= 0) {
		count++;
		index = text.indexOf(separator, index + separator.length);
	}
	return count;
}

/**
 * Wide code points: Hangul Jamo, CJK radicals to Yi, Hangul syllables, CJK compatibility and
 * forms, full-width forms and the supplementary ideographic planes.
 */
function wide(code: number): boolean {
	return (
		(code >= 0x1100 && code <= 0x115f) ||
		(code >= 0x2e80 && code <= 0xa4cf) ||
		(code >= 0xac00 && code <= 0xd7a3) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0xfe30 && code <= 0xfe4f) ||
		(code >= 0xff00 && code <= 0xff60) ||
		(code >= 0xffe0 && code <= 0xffe6) ||
		(code >= 0x20000 && code <= 0x3fffd)
	);
}

/** Argument modifiers such as `|plural(one=item,other=items)`, quoted forms included. */
const MODIFIER = /\|(?:plural|ordinal|gender|hpp)\((?:"(?:[^"\\]|\\.)*"|[^()"])*\)/gu;

/** JavaScript's `\s`, by code unit. */
function space(code: number): boolean {
	return code <= 0x20
		? code === 0x20 || (code >= 0x09 && code <= 0x0d)
		: code >= 0xa0 &&
				(code === 0xa0 ||
					code === 0x1680 ||
					(code >= 0x2000 && code <= 0x200a) ||
					code === 0x2028 ||
					code === 0x2029 ||
					code === 0x202f ||
					code === 0x205f ||
					code === 0x3000 ||
					code === 0xfeff);
}

/**
 * Length a reader sees: rich-text tags, argument modifiers and `{argument}` placeholders removed,
 * whitespace runs counted as one space, ends trimmed. Each code point counts 1; East Asian wide
 * characters count 2, since one carries about as much as two Latin letters. That keeps the ratio
 * between a Latin source and a Chinese, Japanese or Korean translation near 1. It runs for every
 * translation, so it scans code units and skips the replacements text without markup needs.
 */
export function visibleTextLength(text: string): number {
	let visible = text;
	if (visible.includes("<")) visible = visible.replace(TAG, "").replace(CLOSING_TAG, "");
	if (visible.includes("|")) visible = visible.replace(MODIFIER, "");
	if (visible.includes("{")) visible = visible.replace(/\{[^{}]*\}/gu, "");
	let length = 0,
		pendingSpace = false;
	for (let index = 0; index < visible.length; index++) {
		let code = visible.charCodeAt(index);
		if (space(code)) {
			pendingSpace = length > 0;
			continue;
		}
		if (code >= 0xd800 && code <= 0xdbff && index + 1 < visible.length) {
			code = visible.codePointAt(index)!;
			if (code > 0xffff) index++;
		}
		length += (pendingSpace ? 1 : 0) + (wide(code) ? 2 : 1);
		pendingSpace = false;
	}
	return length;
}

/**
 * Length outliers: a source of at least 20 visible characters whose translation is under a third
 * or over three times as long. Ordinary expansion stays far inside (German and French run about
 * 1.2–1.4×, East Asian scripts near 1× with wide characters counted twice), so an outlier is
 * likely a truncated, untranslated-and-padded or wrong-line translation. Shorter sources are
 * skipped: a few characters swing their ratios too far to mean anything.
 */
export const LENGTH_OUTLIER = { minimumSourceLength: 20, minimumRatio: 1 / 3, maximumRatio: 3 };

/** `sourceLength` lets a caller measure one source once for every culture. */
export function lengthOutlier(
	source: string,
	translation: string,
	sourceLength = visibleTextLength(source)
) {
	if (sourceLength < LENGTH_OUTLIER.minimumSourceLength) return undefined;
	const length = visibleTextLength(translation);
	if (length === 0) return undefined;
	const ratio = length / sourceLength;
	if (ratio >= LENGTH_OUTLIER.minimumRatio && ratio <= LENGTH_OUTLIER.maximumRatio)
		return undefined;
	return { length, sourceLength, ratio: Math.round(ratio * 100) / 100 };
}

// Upper-case markers only: "todo" is Spanish and Portuguese for "all".
const PLACEHOLDER_MARKERS = /\b(?:TODO|TBD|FIXME)\b/gu;
const PLACEHOLDER_PHRASES = /lorem ipsum|\bto be translated\b|\bplaceholder\b/giu;

/** Placeholder markers and phrases in source text, in order of appearance. */
export function placeholderMatches(text: string): string[] {
	const matches = [
		...text.matchAll(PLACEHOLDER_MARKERS),
		...text.matchAll(PLACEHOLDER_PHRASES)
	].sort((a, b) => a.index - b.index);
	return matches.map((match) => match[0]);
}

const LETTER = /\p{L}/u;

/** Text with digits and no letters or format arguments, such as "100", "3/4" or "+25%". */
export function numberOnlyText(text: string): boolean {
	return /\p{N}/u.test(text) && !LETTER.test(text) && !text.includes("{");
}

/** Sources worth grouping as "Same text, different keys": they have letters. */
export function sharedSourceCandidate(text: string): boolean {
	return LETTER.test(text);
}

/** Sources whose translations should agree: letters and at least three visible characters. */
export function consistentTranslationCandidate(text: string): boolean {
	return LETTER.test(text) && visibleTextLength(text) >= 3;
}

/** Leading and trailing whitespace and runs of two or more spaces inside the text. */
export function sourceWhitespace(text: string) {
	const leading = /^\s*/u.exec(text)![0],
		trailing = leading.length === text.length ? "" : /\s*$/u.exec(text)![0];
	const inner = text.slice(leading.length, text.length - trailing.length);
	return { leading, trailing, repeatedSpaces: [...inner.matchAll(/ {2,}/gu)].length };
}
