---
"@ue-shed/game-text": patch
---

Building a full Game Text join no longer fails with `Segment was not requested` when the join's
source strings were already published in the shared index. The joined source cache now loads the
string segments it reads instead of relying on the caller to have loaded them first.
