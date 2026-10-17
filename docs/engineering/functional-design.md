# Functional design

## Functional programming with an Effect core

Use immutable values, algebraic data types, exhaustive matching, and composition by default. Effect
owns application workflows and policy wherever state, failure, concurrency, configuration,
resources, telemetry, or external interaction is involved.

Pure code should handle folds, diffs, validation, state changes, compatibility, scheduling policy, and
timeline edits.

Pure functions remain normal building blocks inside Effect workflows. They do not form a second
runtime or own effectful workflow policy. Effect handles clocks, config, files, processes, sockets,
pipes, Unreal, queues, streams, services, and telemetry.

Do not wrap a trivial deterministic calculation only for appearances. Do not hide state in globals
or pass ad-hoc dependency bags through workflows; define services and layers. Obtain clocks,
configuration, and seeded randomness from the Effect environment when behavior depends on them.

## State

- Prefer immutable values.
- Return the next state instead of mutating shared state.
- Use unions instead of boolean flag bags.
- Put needed mutation behind a small tested interface.
- Make ownership, cancellation, queue limits, and retention clear.
- Prefer object arguments for non-trivial calls.

Domain packages must not depend on Workbench. A test or CLI should be able to run the same behavior.

## Package boundaries

- A package may have a single consumer. `host` and `plugin-distribution` stay separate packages
  even though one application uses each: the package line keeps the dependency direction, the
  public surface and the release unit explicit, and lets a second host adopt the package without a
  move. Do not merge a package into its consumer only because it has one.
- Each public library entry point is a boundary. Callers can reach it from plain JavaScript, a
  different package version or a host that skipped TypeScript, so an entry point may decode its
  input with Effect Schema even when the parameter type already describes it. Internal modules
  behind the entry point trust typed values and do not decode again; carry evidence in branded
  types instead of re-validating.
