---
"@ue-shed/protocol": minor
"@ue-shed/game-text": minor
"@ue-shed/unreal-assets": minor
"@ue-shed/unreal-connection": minor
"@ue-shed/cameras": minor
---

Error messages no longer embed a stringified cause (`String(cause)` or `Cause.pretty`). Each message says what failed and which ids are involved; the original failure is kept on the error's `cause` field (`ErrorCauseFields` from `@ue-shed/protocol`), so message text changes across these packages and several apps.

- Game Text's cache failures are classified by filesystem code instead of reporting every failure as "unavailable, retry": `ENOENT` is `missing`, `EBUSY` is `busy`, and `EACCES`, `EPERM` and `ENOSPC` keep `unavailable` with a specific recovery.
- `TextCorpusScanError` and `TextCorpusPublicError` gain the `invalid_options` code for malformed scan options, which were reported as `scan_limit_exceeded`.
- The camera render `artifact_invalid` failure is split into codes that say which artifact check failed.

Migration: match on codes and `nextStep`, not on message text. Read `cause` when you need the underlying failure for diagnostics. Handle `invalid_options` wherever you switch on Game Text scan error codes.
