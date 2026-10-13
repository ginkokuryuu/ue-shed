---
"@ue-shed/map-history": minor
---

Require `p4client-ts@0.12.0`. Perforce failures that previously returned empty results now surface as
typed Map History errors: permission failures map to `perforce_authentication`, paths outside the
client view to `ambiguous_depot_mapping`, and unknown user or charset failures to
`perforce_configuration`. Install the matching exact `p4client-ts` version alongside this package.
