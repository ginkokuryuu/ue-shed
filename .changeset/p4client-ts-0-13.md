---
"@ue-shed/map-history": minor
---

Require `p4client-ts@0.13.0`. Map History now runs Perforce commands through p4client-ts's native
Effect `P4` layer on the application's Effect runtime, so they share its interruption and no
separate Promise runtime is created; p4client-ts also takes `effect@^4.0.0` as a peer, so one
Effect installation serves both. `perforceHistorySourceLayer` accepts p4client-ts 0.13's
`P4ClientOptions`, which move the top-level `port`, `user`, `client` and `charset` into
`connection`, plus an optional layer factory for tests. Perforce configuration failures still map to `perforce_configuration`.
Install the matching exact `p4client-ts` version alongside this package.
