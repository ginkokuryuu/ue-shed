# `@ue-shed/observability`

The application must provide `effect@^4.0.0` as a peer dependency. Reuse one compatible
Effect installation across the application and UE Shed libraries.
Also install `@effect/opentelemetry@^4.0.0` in the application.

Shared, headless OpenTelemetry composition, bounded runtime metrics, and schema-owned health for UE
Shed hosts. Applications provide `runtimeObservabilityLayer` once at their root. Local use does not
require an exporter; set `UE_SHED_TELEMETRY_MODE=console` to emit local traces, metrics, and logs.

```sh
npm install --save-exact @ue-shed/observability "effect@^4.0.0" "@effect/opentelemetry@^4.0.0"
```

`RuntimeHealthService` is the diagnostic authority for CLI and UI clients. Consumers report typed
capability, connection, reader, stream, and telemetry state rather than parsing logs.

Node.js 22.14 or newer is required. This is a headless Node-host package; it does not depend on
Workbench, Electron, or any Unreal plugin.
