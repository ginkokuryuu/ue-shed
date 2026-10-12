---
"@ue-shed/game-text": minor
---

Add an injectable GameTextIndexBuilder capability and a TypeScript fallback layer for localization import, saved package text, dictionary maintenance and joined target publication. The shared refresh service uses the selected builder and retains published reader generations while inputs and review state refresh under one writer lease.

Add an opt-in columnar implementation of the existing TextCorpusQuery API, including search, facets, filters, pages, focus and exports. Its private joined query projections rebuild derived caches under a new joined key. Production host adoption is pending resolution of the documented lone UTF-16 surrogate fidelity defect.
