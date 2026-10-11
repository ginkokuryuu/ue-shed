---
"@ue-shed/game-text": patch
---

Preserve lone UTF-16 surrogates in every Game Text index string domain using canonical WTF-8. Disposable snapshot format v4 rebuilds older caches and rejects malformed or non-canonical byte sequences. Search, findings and joined query projections retain the original code units.
