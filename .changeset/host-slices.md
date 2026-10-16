---
"@ue-shed/game-text": patch
---

Index builds no longer block the host's event loop for seconds. On a cold scan of a large project the
longest block fell from about 13 s to about half a second, so a server host keeps answering progress
and other requests. Index steps run on a scheduler that yields once the event loop has gone 16 ms
without a turn, and the long synchronous passes (duplicate places, query columns, query places, locale
sorts, package selection and the inventory sort) yield between bounded slices. Opening the finished
query model is unchanged and can still block for up to about a second.
