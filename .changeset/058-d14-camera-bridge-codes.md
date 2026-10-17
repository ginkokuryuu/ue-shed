---
"@ue-shed/cameras": minor
---

Camera authoring bridge failures name their cause. UEShedCameraAuthoringBridge and its native setup collapsed about 50 causes into five statuses (`busy`, `stale`, `unavailable`, `invalid`, `detached`) that only the prose told apart.

Each failure now adds a stable `code`, for example `scope_mismatch`, `revision_conflict`, `editor_owned`, `camera_not_in_arrangement` or `setup_owned`. The status stays the same coarse category. The camera-authoring v1 bridge-response contract and `CameraBridgeResponse` accept the optional `code` (lower snake case, at most 64 characters), and `readyCameraBridge` passes it on as `CameraBridgeError.cause`.

Additive: older bridges' responses still decode, and existing `code` categories on `CameraBridgeError` are unchanged.
