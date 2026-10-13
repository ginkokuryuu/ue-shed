---
"@ue-shed/game-text": minor
---

Keep a server host responsive while a Game Text index refreshes. Inventory selection, the full
localization join, cold dictionary merges and compaction now run in bounded host-thread slices
that yield to the event loop, with byte-identical index output. With a search worker, opening a
target no longer warms presentation pages on the host thread.

Add `materializeTextCorpus`, which copies a corpus into a plain value, decoding an indexed corpus's
units in bounded slices. Use it instead of spreading a refresh result's `corpus` when the copy must
outlive the pinned index.
