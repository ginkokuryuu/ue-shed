---
"@ue-shed/game-text": minor
---

Expose optional, operation-scoped progress for saved package inventory, package extraction,
localization file preparation, index construction and opening the joined index.

Share package extraction and strings across a project's source and localization target indexes,
retain independent joined target views, and reuse signature inventories within a committed
Project Index generation.

Expose project opening and refresh, localization import, target construction, and query opening
as independently composable `GameTextIndexSteps`. Keep the existing refresh service as a
compatibility wrapper, provide a retainer for host-owned compositions, and replace encoded
target storage keys with explicit project views.
