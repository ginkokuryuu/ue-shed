---
"@ue-shed/game-text": minor
---

**Breaking:** Game Text's exported result decoders are unary domain parsers. They fail with the new `GameTextResponseError` (`code: "invalid_response"`, `message`, `recovery`, `retrySafe`, and the schema issue as `cause`) instead of Schema's parse error:

| Removed                             | Use                                |
| ----------------------------------- | ---------------------------------- |
| `decodeTextCorpusRunResult`         | `parseTextCorpusRunResult`         |
| `decodeTextCorpusQueryRunResult`    | `parseTextCorpusQueryRunResult`    |
| `decodeTextCorpusSearchResult`      | `parseTextCorpusSearchResult`      |
| `decodeTextCorpusFocusResult`       | `parseTextCorpusFocusResult`       |
| `decodeTextQualityQueryRunResult`   | `parseTextQualityQueryRunResult`   |
| `decodeTextQualityRuleUpdateResult` | `parseTextQualityRuleUpdateResult` |
| `decodeTextQualitySearchResult`     | `parseTextQualitySearchResult`     |
| `decodeTextQualityFocusResult`      | `parseTextQualityFocusResult`      |
| `decodeTextQualityReport`           | `parseTextQualityReport`           |

`TextCorpusScanOptions` limits (`concurrency`, `maximumAssets`) are the branded `TextCorpusScanLimit`. The brand carries the positive-integer check, so `TextCorpusService.scan` and `scanFromProjectIndex` no longer decode their typed options a second time. `parseTextCorpusScanOptions` checks options from an untrusted source once, and fails with `TextCorpusScanError` code `invalid_options`, not the old mislabelled `scan_limit_exceeded`.

Migration:

- Rename `decode*` to `parse*` from the table. Handle `GameTextResponseError` where you handled a `SchemaError`.
- Build scan limits with `TextCorpusScanLimit.make(n)`, or parse untrusted options with `parseTextCorpusScanOptions(...)` before calling `scan`.
