---
"@ue-shed/game-text": minor
"@ue-shed/cli": patch
"@ue-shed/workbench": patch
---

Serve CLI and Workbench Game Text queries from a shared column index through one refresh service
and an injectable builder capability. Preserve existing pages, filters, facets, focus and reports;
refresh changed packages and localization files, and invalidate affected layers after writes.
Retain bounded reader generations and remove the large-heap setup requirement from the docs.
