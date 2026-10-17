---
---

Internal cleanups with no consumer-facing change: Effect pipes with several `flatMap`/`andThen` steps read as generators, `Effect.fn` bodies take their trailing transforms as arguments, plan-phase comments describe the code instead, and every production `SAFETY:` type assertion names the tests that verify it. New lint rules keep each of these from coming back.
