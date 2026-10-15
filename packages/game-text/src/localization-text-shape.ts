/**
 * Pure text measurements behind the built-in shape and source checks. Each works on one string or
 * one source/translation pair, so in-memory and indexed scans share them line by line.
 */

/**
 * Opening and self-closing Slate rich-text tags: `<b>`, `<Name attr="x">`, `<img id="x"/>`. As in
 * Slate's markup parser, attributes are `name="value"` pairs, so `<invalid requirement type>` is
 * text, not a tag.
 */
const TAG = /<([A-Za-z_][\w.-]*)(?:\s+[\w.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*\/?>/gu;
const CLOSING_TAG = /<\/>/gu;
/** A tag whose name is a format argument, `<{Color}>`: the game picks the style at runtime. */
const ARGUMENT_TAG = /<\{[^{}<>]+\}>/gu;
/** XML-style closing tags, `</Name>`; Slate closes rich text only with `</>`. */
const XML_CLOSING_TAG = /<\/([A-Za-z_][\w.-]*)\s*>/gu;
const ASCII_IDENTIFIER = /[A-Za-z0-9_]/u;

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

/**
 * Opening tags (named or `<{argument}>`, not self-closing) and `</>` closings, for source markup
 * balance, and the names of XML-style `</Name>` closings, which Slate shows as text. A tag right
 * after an ASCII letter, digit or underscore is code, as in `GetSubsystem<UMySubsystem>()`.
 */
export function richTextTagBalance(text: string) {
	const xmlClosings: string[] = [];
	if (!text.includes("<")) return { opening: 0, closing: 0, xmlClosings };
	let opening = 0;
	const code = (index: number) => index > 0 && ASCII_IDENTIFIER.test(text[index - 1]!);
	for (const match of text.matchAll(TAG))
		if (!match[0].endsWith("/>") && match[1]!.toLowerCase() !== "br" && !code(match.index))
			opening++;
	if (text.includes("<{")) opening += [...text.matchAll(ARGUMENT_TAG)].length;
	for (const match of text.matchAll(XML_CLOSING_TAG)) xmlClosings.push(match[1]!);
	return { opening, closing: [...text.matchAll(CLOSING_TAG)].length, xmlClosings };
}

/** A rich-text tag around nothing but one format argument: `<PlayerName>{ParentLabel}</>`. */
const ARGUMENT_WRAPPER = /<[A-Za-z_][\w.-]*>\{([^{}<>|]+)\}<\/>/gu;

/**
 * The text with each tag that wraps only an optional argument removed, the argument kept, so tag
 * comparison leaves those tags out.
 */
export function withoutOptionalArgumentTags(
	text: string,
	optionalArguments: ReadonlySet<string>
): string {
	if (optionalArguments.size === 0 || !text.includes("<")) return text;
	return text.replace(ARGUMENT_WRAPPER, (whole, argument: string) =>
		optionalArguments.has(argument) ? `{${argument}}` : whole
	);
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

/**
 * Chinese, Japanese, Korean and Thai translations often run shorter than wide characters counted
 * twice allow for, so their minimum ratio is a quarter.
 */
const COMPACT_CULTURE = /^(?:zh|ja|ko|th)(?:-|$)/iu;
export const COMPACT_MINIMUM_RATIO = 0.25;

/** The shortest translation, relative to its source, that is not a length outlier. */
export function lengthOutlierMinimumRatio(culture: string): number {
	return COMPACT_CULTURE.test(culture) ? COMPACT_MINIMUM_RATIO : LENGTH_OUTLIER.minimumRatio;
}

/** `sourceLength` lets a caller measure one source once for every culture. */
export function lengthOutlier(
	source: string,
	translation: string,
	sourceLength = visibleTextLength(source),
	minimumRatio = LENGTH_OUTLIER.minimumRatio
) {
	if (sourceLength < LENGTH_OUTLIER.minimumSourceLength) return undefined;
	const length = visibleTextLength(translation);
	if (length === 0) return undefined;
	const ratio = length / sourceLength;
	if (ratio >= minimumRatio && ratio <= LENGTH_OUTLIER.maximumRatio) return undefined;
	return { length, sourceLength, ratio: Math.round(ratio * 100) / 100 };
}

/**
 * Words translators leave in place of a translation, compared trimmed, lower-cased and without
 * trailing punctuation. "script lama" is Indonesian for "old script". "todo" is Spanish and
 * Portuguese for "all", so only an upper-case `TODO` counts.
 */
const PLACEHOLDER_TRANSLATIONS = new Set([
	"skip",
	"skipped",
	"script lama",
	"tbd",
	"tba",
	"fixme",
	"placeholder",
	"to be translated",
	"untranslated",
	"not translated",
	"n/a",
	"xxx"
]);
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;

/**
 * A translation that is only a placeholder word, or only punctuation ("...", ".", "-") for a
 * source of three words or more, as written; undefined otherwise. A source with no letters, one
 * that is itself a placeholder (`placeholder_text`'s) and a translation equal to its source are
 * left out. Shorter sources may be answered with "..." on purpose, as a silent reply.
 */
export function placeholderTranslation(source: string, translation: string): string | undefined {
	const trimmed = translation.trim();
	if (trimmed.length === 0 || trimmed.length > 24 || !LETTER.test(source)) return undefined;
	if (translationGroupKey(trimmed) === translationGroupKey(source)) return undefined;
	if (
		placeholderMatches(source).length ||
		PLACEHOLDER_TRANSLATIONS.has(
			source
				.trim()
				.toLowerCase()
				.replace(/[\p{P}\s]+$/u, "")
		)
	)
		return undefined;
	if (!LETTER_OR_NUMBER.test(trimmed)) return visibleWordCount(source) >= 3 ? trimmed : undefined;
	const word = trimmed.toLowerCase().replace(/[\p{P}\s]+$/u, "");
	if (word === "todo") return trimmed.startsWith("TODO") ? trimmed : undefined;
	return PLACEHOLDER_TRANSLATIONS.has(word) ? trimmed : undefined;
}

// Upper-case markers only: "todo" is Spanish and Portuguese for "all".
const PLACEHOLDER_MARKERS = /\b(?:TODO|TBD|FIXME)\b/gu;
const PLACEHOLDER_PHRASES = /lorem ipsum|\bto be translated\b|\bplaceholder\b/giu;
/** Any of them, in any case: one test rules out nearly every line. */
const PLACEHOLDER_ANY = /todo|tbd|fixme|lorem ipsum|to be translated|placeholder/iu;

/** Placeholder markers and phrases in source text, in order of appearance. */
export function placeholderMatches(text: string): string[] {
	if (!PLACEHOLDER_ANY.test(text)) return [];
	const matches = [
		...text.matchAll(PLACEHOLDER_MARKERS),
		...text.matchAll(PLACEHOLDER_PHRASES)
	].sort((a, b) => a.index - b.index);
	return matches.map((match) => match[0]);
}

const LETTER = /\p{L}/u;

/** Text with digits and no letters or format arguments, such as "100", "3/4" or "+25%". */
export function numberOnlyText(text: string): boolean {
	return !text.includes("{") && !LETTER.test(text) && /\p{N}/u.test(text);
}

/** Sources worth grouping as "Same text, different keys": they have letters. */
export function sharedSourceCandidate(text: string): boolean {
	return LETTER.test(text);
}

/** Words in the text a reader sees: runs without whitespace, rich-text tags removed. */
export function visibleWordCount(text: string): number {
	const visible = text.includes("<") ? text.replace(TAG, " ").replace(CLOSING_TAG, " ") : text;
	return visible.match(/\S+/gu)?.length ?? 0;
}

/** The most words a source may have for `inconsistent_translation`: names, labels, short UI text. */
export const CONSISTENT_TRANSLATION_MAXIMUM_WORDS = 4;

/**
 * Sources whose translations should agree: letters, at least three visible characters and at
 * most four words. Longer sentences are often translated to fit their scene.
 */
export function consistentTranslationCandidate(text: string): boolean {
	return (
		LETTER.test(text) &&
		visibleTextLength(text) >= 3 &&
		visibleWordCount(text) <= CONSISTENT_TRANSLATION_MAXIMUM_WORDS
	);
}

/**
 * The form translations are grouped by: lower-cased, without whitespace, punctuation and symbols,
 * so "Danke!" and "danke" count as one translation. Text that is only those keeps its trimmed
 * form.
 */
export function translationGroupKey(text: string): string {
	const key = text.toLowerCase().replace(/[\p{P}\p{S}\p{Z}\s]+/gu, "");
	return key.length ? key : text.trim();
}

/** Line breaks between the first and last visible characters; edges are the whitespace check's. */
export function interiorLineBreaks(text: string): number {
	let start = 0,
		end = text.length;
	while (start < end && space(text.charCodeAt(start))) start++;
	while (end > start && space(text.charCodeAt(end - 1))) end--;
	let count = 0;
	for (let index = start; index < end; index++) {
		const code = text.charCodeAt(index);
		if (code === 0x0a) count++;
		else if (code === 0x0d) {
			count++;
			if (text.charCodeAt(index + 1) === 0x0a) index++;
		}
	}
	return count;
}

/** The text with `\r\n` and lone `\r` written as `\n`. */
export function normalizedLineEndings(text: string): string {
	return text.includes("\r") ? text.replace(/\r\n?/gu, "\n") : text;
}

/** Leading and trailing whitespace and runs of two or more spaces inside the text. */
export function sourceWhitespace(text: string) {
	let start = 0,
		end = text.length;
	while (start < end && space(text.charCodeAt(start))) start++;
	while (end > start && space(text.charCodeAt(end - 1))) end--;
	let repeatedSpaces = 0;
	for (let index = text.indexOf("  ", start); index >= 0 && index + 1 < end; ) {
		repeatedSpaces++;
		while (index < end && text.charCodeAt(index) === 0x20) index++;
		index = text.indexOf("  ", index);
	}
	return { leading: text.slice(0, start), trailing: text.slice(end), repeatedSpaces };
}
