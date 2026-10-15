---
"@ue-shed/game-text": minor
---

Evaluate source quality rules over the Game Text index.

An opened index model's `sourceQuality(ruleDocument, options?)`, also exported as
`indexedSourceQuality(joined, corpus, ruleDocument, options?)`, returns the `TextQualityQuery`
that `textQualityQuery(evaluateGameTextSourceQuality(corpus, ruleDocument))` gives, with the same
summary, pages, cursors, focus, export and finding IDs. It reads roles, character budgets and
terminology page by page from index columns, never builds the corpus's units, keeps each finding
as a few numbers and rebuilds only the findings a page, focus or export returns. The scan yields
between pages and can be interrupted; `onProgress` receives `SourceQualityProgress`
(`{ checkedTextUnits, totalTextUnits, findings }`) once before the scan and after each page.
`evaluateGameTextSourceQuality` and `textQualityQuery` keep their contracts for hosts without an
index. `textQualityQueryOf(report, list)` builds the query over any finding list.

Roles match a place by its own location. A folded Blueprint place's copies never match by their
compiled paths (`X_C`, `Default__X_C`, `SKEL_X_C`); write roles against the authored path.
