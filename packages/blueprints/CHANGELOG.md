# @ue-shed/blueprints

## 0.14.0

### Patch Changes

- d8eca33: Upgrade Effect and its integrations to stable 4.0.4. Update renamed schema and configuration APIs,
  JSON Schema validation, synchronous cache queries, retained resource cleanup, and Remote Control
  response handling while preserving authoritative wire contracts and existing workflow behavior.
  Published libraries now require the application to provide `effect@^4.0.0` as a peer dependency,
  and `@ue-shed/observability` also requires `@effect/opentelemetry@^4.0.0`. Install these in the
  application (or reuse compatible existing versions) so UE Shed shares the application's Effect
  runtime. Workspace development and tests remain pinned to Effect 4.0.4 through the catalog.
- Updated dependencies [8f9bcf1]
- Updated dependencies [d8eca33]
    - @ue-shed/protocol@0.14.0

## 0.13.0

### Patch Changes

- @ue-shed/protocol@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [d90ae25]
    - @ue-shed/protocol@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [1f01e74]
- Updated dependencies [a545cd5]
- Updated dependencies [580442c]
- Updated dependencies [67a611c]
    - @ue-shed/protocol@0.11.0

## 0.10.0

No direct behavioral change. Align with the UE Shed 0.10.0 suite and exact internal dependency pins.

### Patch Changes

- Updated dependencies [8e83f1a]
- Updated dependencies [5fd5bc7]
    - @ue-shed/protocol@0.10.0

## 0.9.3

No direct behavioral change. Align with the UE Shed 0.9.3 suite and exact internal dependency pins.

### Patch Changes

- @ue-shed/protocol@0.9.3

## 0.9.2

### Patch Changes

- @ue-shed/protocol@0.9.2

## 0.9.1

### Patch Changes

- Updated dependencies [ce281fb]
- Updated dependencies [ce281fb]
    - @ue-shed/protocol@0.9.1

## 0.9.0

### Minor Changes

- 4191d85: Add headless saved Blueprint graph indexing, navigation, bounded search, reference layout and display
  metadata. Keep the Solid viewer in Workbench and have it consume the public helpers, including search
  across saved nodes and pins. Preserve ambiguous identities, opaque evidence and absent saved values.

### Patch Changes

- Updated dependencies [a3b58fd]
- Updated dependencies [f69d878]
- Updated dependencies [b8c7623]
- Updated dependencies [679d972]
- Updated dependencies [e5c5811]
- Updated dependencies [3d4c6b1]
    - @ue-shed/protocol@0.9.0
