---
"@ue-shed/game-text": patch
---

The package text refresh, the full join and the localization quality scan report their stages as span attributes (`package-text.stage_ms.*`, `join.stage_ms.*`, `game_text.quality.stage_ms.*`). Each one is the wall time of one stage of that step in milliseconds, so a host's tracer can show where a build or a scan spends its time. No API changes.
