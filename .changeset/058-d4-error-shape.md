---
"@ue-shed/protocol": minor
"@ue-shed/unreal-connection": minor
"@ue-shed/unreal-assets": minor
"@ue-shed/cameras": minor
"@ue-shed/engine": minor
---

**Breaking:** tagged errors in `@ue-shed/unreal-connection`, `@ue-shed/unreal-assets` and `@ue-shed/cameras` share one shape: `message`, `recovery`, `retrySafe` and a typed `nextStep` (`"fix_input" | "retry" | "reconcile" | "escalate"`) beside their existing context fields.

- `@ue-shed/protocol` exports `ErrorGuidanceFields` and `ErrorNextStep` for that shape.
- `RemoteControlClientError`, `UnrealConnectionError`, `UnrealCapabilityError`, `AssetReaderError`, `InvestigationError`, the six `ProjectIndex*` errors and the camera, capture, map-tile and review errors now carry `recovery` and `nextStep`. Errors that had no `retrySafe` gain it.
- `nextStep: "retry"` appears only when `retrySafe` is true. Mutations whose outcome is unknown after a transport failure report `reconcile`.
- Low-level `RemoteControlClient.request` defaults to non-idempotent. Set `idempotent: true` only for reads or operations with a proven replay guarantee. A lost response, timeout or server failure can occur after applying a mutation; it is never proof that replay is safe.
- Renderer reads preserve typed connection guidance, and malformed capability/preflight responses require escalation instead of transient retries.
- `EditorConnectionError` also adopts the shared guidance fields. Editor readiness preserves upstream recovery instructions and polls only transient failures with `nextStep: "retry"`; permanent refusals and malformed responses fail immediately even when repeating the read is safe.
- Malformed outer HTTP JSON follows the same recovery rules as malformed Remote Control envelopes: reconcile uncertain mutations and escalate read protocol failures.

Migration: read `nextStep` instead of parsing `message` or branching on `kind`/`code` to decide what to do next. Code that constructs these errors itself (test doubles, custom reader or Remote Control layers) must pass `recovery`, `nextStep` and, where new, `retrySafe`.
