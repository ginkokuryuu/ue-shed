---
"@ue-shed/game-text": minor
"@ue-shed/unreal-assets": minor
"@ue-shed/protocol": minor
"@ue-shed/uasset": minor
---

Add an opt-in native Game Text index builder through the existing scoped uasset-io protocol
session. The builder writes the existing shared dictionary and column format, supports narrowly
eligible incremental joins, and preserves the current JavaScript query interface. TypeScript
remains the default builder. Give decoded shared-string arenas their own buffers so cache
accounting tracks their actual capacity.
