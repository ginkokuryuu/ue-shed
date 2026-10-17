---
"@ue-shed/game-text": minor
---

**Breaking:** Game Text reports progress one way. `GameTextIndexProgressReporter`, which index refreshes already used, is now the only mechanism, and `GameTextIndexProgress` gains the phases `corpus`, `localization_quality` and `source_quality` and an optional `findings` count.

- `localizationQuality` and `sourceQuality` no longer take an `onProgress` callback. `LocalizationQualityProgress`, `SourceQualityProgress` and `IndexedSourceQualityOptions` are removed, and `IndexedLocalizationQualityOptions` is now the check options alone.
- `TextCorpusService` no longer has `progress()`, which polled one shared state, so concurrent scans overwrote each other's progress. Scans now report `corpus` events instead.
- `localizationQuality` and `sourceQuality` are required on `GameTextIndexRefreshResult`, and both take the rule document first: `localizationQuality(ruleDocument?, options?)` and `sourceQuality(ruleDocument)`. `indexedLocalizationQuality` takes `(joined, corpus, evidence, rows, ruleDocument?, options?)`; `indexedSourceQuality` takes `(joined, corpus, ruleDocument)`.

Migration:

- Replace `result.localizationQuality(options, document)` with `result.localizationQuality(document, options)`, and `result.localizationQuality({ review })` with `result.localizationQuality(undefined, { review })`.
- Drop the `!` on `localizationQuality` and `sourceQuality`, and remove any fallback to the in-memory checks. An adapter that builds its own index result implements both, for example with `localizationQuality(checkLocalizationTarget(...), join)` and `textQualityQuery(evaluateGameTextSourceQuality(corpus, document))`.
- Replace `{ onProgress }` and `TextCorpusService.progress()` polling with `effect.pipe(Effect.provideService(GameTextIndexProgressReporter, (progress) => ...))`. Read `completed`, `total` and `findings` instead of `checkedLines`, `totalLines`, `checkedTextUnits` and `totalTextUnits`.
