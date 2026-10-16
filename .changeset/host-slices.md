---
"@ue-shed/game-text": patch
---

Index builds no longer block the host's event loop. On a cold scan of a large project the longest block fell
from 14.2 s to under a second, so a server host keeps answering progress and other requests.
Index steps run on a scheduler that yields once the event loop has gone 16 ms without a turn, and
the long synchronous passes (duplicate places, query columns, query places, locale sorts, package
selection and the inventory sort) yield between bounded slices.
