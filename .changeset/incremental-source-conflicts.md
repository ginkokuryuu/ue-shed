---
"@ue-shed/game-text": patch
---

Refresh stable package source edits incrementally when localization source conflicts are created,
changed or resolved. Preserve full-rebuild states and query projections with bounded source-list
patches over one retained base snapshot.

Reuse immutable query columns and encoded source bytes across incremental refreshes while keeping
patched values and older readers isolated. Rebuild the source search arena when reuse bounds are
exceeded or the dictionary generation or full base changes.
