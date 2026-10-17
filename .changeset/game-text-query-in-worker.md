---
"@ue-shed/game-text": patch
---

With `searchWorker: true`, `openTarget` no longer prepares the query on the host's thread. The search worker prepares it once, and the model's synchronous `query` methods borrow the worker's query: each call blocks until the worker answers. Before, the host prepared the same query a second time while blocking its event loop (about 1.15 s on a large project). If the worker has died, the next synchronous call prepares the query on the host instead, so an open model keeps working. Hosts without a search worker are unchanged. Join place-label lookups now read strings in batches of 1,024 instead of 8,192, so one batch no longer holds the host's event loop for long. No API changes.
