---
"@ue-shed/protocol": minor
"@ue-shed/unreal-connection": minor
"@ue-shed/unreal-assets": minor
"@ue-shed/cameras": minor
---

**Breaking:** tagged errors in `@ue-shed/unreal-connection`, `@ue-shed/unreal-assets` and `@ue-shed/cameras` share one shape: `message`, `recovery`, `retrySafe` and a typed `nextStep` (`"fix_input" | "retry" | "reconcile" | "escalate"`) beside their existing context fields.

- `@ue-shed/protocol` exports `ErrorGuidanceFields` and `ErrorNextStep` for that shape.
- `RemoteControlClientError`, `UnrealConnectionError`, `UnrealCapabilityError`, `AssetReaderError`, `InvestigationError`, the six `ProjectIndex*` errors and the camera, capture, map-tile and review errors now carry `recovery` and `nextStep`. Errors that had no `retrySafe` gain it.
- `nextStep: "retry"` appears only when `retrySafe` is true. Mutations whose outcome is unknown after a transport failure report `reconcile`.

Migration: read `nextStep` instead of parsing `message` or branching on `kind`/`code` to decide what to do next. Code that constructs these errors itself (test doubles, custom reader or Remote Control layers) must pass `recovery`, `nextStep` and, where new, `retrySafe`.
