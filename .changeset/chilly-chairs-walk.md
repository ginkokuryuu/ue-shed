---
"@ue-shed/game-text": patch
---

Add scoped worker-backed compact-index search for desktop and trusted Node hosts. Cancel replaced
scans without evicting completed results, and reuse prepared WTF-8 source bytes for case-insensitive
search. Preserve translations in schema-validated text-unit previews.

Treat failed current localization inputs as unavailable instead of reusing historical layers.
Preserve empty-source units in raw corpus hydration. Separate retained-model publication from
reader retirement and keep outstanding query users pinned through replacement.
