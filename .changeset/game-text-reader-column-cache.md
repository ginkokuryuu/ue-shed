---
"@ue-shed/game-text": patch
---

Views of one opened index share its decoded columns and its synchronous reader. Before, the query, the corpus, the localization evidence and each quality scan each kept their own column cache and their own patch and chunk caches. Synchronous string lookups no longer rebuild the segment start list on every lookup, and a lookup in the same 64-string block as the one before reuses that block directly. Quality scans and line reads go through these lookups for every line. No API changes.
