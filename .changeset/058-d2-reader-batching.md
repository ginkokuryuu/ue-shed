---
"@ue-shed/game-text": minor
"@ue-shed/unreal-assets": minor
---

`gameTextIndexSourceNodeLayer` now splits a read into reader requests that each fit the native reader's 4 MiB request frame, so a host can hand it every selected package of a large project without batching the paths itself. Each batch is signature-verified before and after its own read and emits its own `text_summary`.

`@ue-shed/unreal-assets` exports the frame limit as `MAX_PROTOCOL_REQUEST_BYTES`, the default per-request path budget as `MAX_PROTOCOL_PATH_BYTES`, and `batchProtocolPaths(paths, maximumPathBytes?)`, which splits package paths into ordered batches that fit one request.

The oversized-request `contract` error now says `split package paths with batchProtocolPaths`.

Migration: hosts that batched paths before calling the Game Text index source can pass the whole selection instead. Hosts that call `extractProjectTextPackages` directly with many paths can use `batchProtocolPaths` instead of their own limit.
