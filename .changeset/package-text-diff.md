---
"@ue-shed/game-text": minor
---

Compare the text of two copies of one package. `diffPackageText(before, after)` takes two package text records (for example the depot's head revision and the local file) and reports added, removed, re-keyed and edited text place by place, matching places by their position inside the package rather than the package's saved name, and says when either copy was read only in part. Additive; no migration needed.
