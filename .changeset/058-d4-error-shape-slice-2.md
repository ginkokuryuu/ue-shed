---
"@ue-shed/engine": minor
"@ue-shed/authoring": minor
"@ue-shed/authoring-sdk": minor
"@ue-shed/host": minor
"@ue-shed/world": minor
"@ue-shed/plugin-distribution": minor
"@ue-shed/localization": minor
"@ue-shed/observatory": minor
"@ue-shed/scenarios": minor
"@ue-shed/niagara": minor
"@ue-shed/config-explorer": minor
"@ue-shed/asset-audits": minor
"@ue-shed/map-history": minor
"@ue-shed/project-custodian": minor
"@ue-shed/enhanced-input": minor
"@ue-shed/protocol": minor
"@ue-shed/ui": minor
---

**Breaking:** the remaining packages' tagged errors gain the shared guidance shape from the first D4 slice: `message`, `recovery`, `retrySafe` and a typed `nextStep` (`"fix_input" | "retry" | "reconcile" | "escalate"`) beside their existing context fields. `nextStep: "retry"` appears only when `retrySafe` is true.

Migration: read `nextStep` instead of parsing `message`. Code that constructs these errors itself (test doubles, custom layers) must pass `recovery`, `retrySafe` and `nextStep` where they are new.
