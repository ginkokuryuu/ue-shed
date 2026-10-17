---
"@ue-shed/game-text": minor
---

**Breaking:** `@ue-shed/game-text` has focused entry points with named exports only, and its storage internals are private.

- New entry points: `@ue-shed/game-text/schema`, `/rules`, `/checks`, `/labels` and `/corpus` (browser-safe), and `/index` (Node: `TextCorpus`, index steps and layers, retained index, rules-file IO, errors and progress).
- The root `@ue-shed/game-text` and `@ue-shed/game-text/browser` still re-export every public name, by name, and are deprecated. They will be removed in a later release.
- No longer exported: the compact snapshot codec (`snapshot-format`), `SnapshotStore` and its layer, `SharedIndex` and `sharedIndexNodeLayer`, the joined-target readers (`openJoinedTarget`, `hydrateJoinedTarget`, `inspectJoinedTarget`, `refreshJoinedTarget`), the package-text record, column, layer, candidate and cold-pool helpers, `decodeLocalizationSnapshot`, `defaultLocalizationImportLimits` and `localizationShippedTranslation`. `SnapshotStoreError` and `SnapshotFormatError` are still exported from `/index` because public index signatures name them.
- Game Text no longer re-exports other packages' types: import `InvestigationFileResult` and `InvestigationFormat` from `@ue-shed/unreal-assets/investigation`, and `LocalizationReviewFlag` from `@ue-shed/localization/browser`.

Migration: replace `@ue-shed/game-text` and `@ue-shed/game-text/browser` imports with the entry point that exports each name; the package README lists what each entry point holds. Hosts that used the private storage modules directly should go through `/index` (`gameTextIndexStepsLayer`, `gameTextIndexRefreshLayer` and the retained index) instead; open an issue if a needed capability is missing there.
