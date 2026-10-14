---
"@ue-shed/blueprints": patch
"@ue-shed/cameras": patch
"@ue-shed/config-explorer": patch
"@ue-shed/engine": patch
"@ue-shed/game-text": patch
"@ue-shed/localization": patch
"@ue-shed/map-history": patch
"@ue-shed/niagara": patch
"@ue-shed/observability": patch
"@ue-shed/observatory": patch
"@ue-shed/plugin-distribution": patch
"@ue-shed/project-custodian": patch
"@ue-shed/protocol": patch
"@ue-shed/unreal-assets": patch
"@ue-shed/unreal-connection": patch
"@ue-shed/world": patch
---

Upgrade Effect and its integrations to stable 4.0.4. Update renamed schema and configuration APIs,
JSON Schema validation, synchronous cache queries, retained resource cleanup, and Remote Control
response handling while preserving authoritative wire contracts and existing workflow behavior.
Published libraries now require the application to provide `effect@^4.0.0` as a peer dependency,
and `@ue-shed/observability` also requires `@effect/opentelemetry@^4.0.0`. Install these in the
application (or reuse compatible existing versions) so UE Shed shares the application's Effect
runtime. Workspace development and tests remain pinned to Effect 4.0.4 through the catalog.
