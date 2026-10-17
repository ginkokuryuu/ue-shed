# Types and errors

## Effect Schema first

Effect Schema is the default source for TypeScript-owned data models. Define the runtime schema first,
then infer its decoded and encoded TypeScript types. Do not write a matching interface by hand.

Build related schemas from the base schema with schema combinators: pick fields, omit fields, extend
records, add brands, compose unions, and transform encoded values. Schemas are immutable values, so
“change a schema” means derive a new schema rather than mutate the original.

This applies to domain values, config, stored documents, service input/output, errors, and messages
owned by TypeScript.

## Boundaries

- Treat config, JSON, Unreal results, frames, files, CLI input, and UI messages as `unknown`.
- Validate once at the boundary.
- Use branded IDs for values with different meanings.
- Use unions to rule out invalid states.
- Prefer Effect Schema derivation. Use TypeScript utilities only for shapes that do not need their own
  runtime schema.
- Avoid `any`, unchecked casts, and non-null assertions in domain code.
- Keep needed low-level casts in one tested place.

For TypeScript-only boundaries, Effect Schema is authoritative. For TypeScript/C++ wire contracts, the
language-neutral schema is authoritative and the Effect Schema representation must match it. Both
implementations use the same conformance fixtures.

## Errors

Expected failures are typed values. This includes missing capabilities, connection loss, bad input,
drift, conflicts, missing actors, and stream gaps.

Define application errors with `Schema.TaggedError` so their tags and structured fields are
schema-owned. Decode unknown input with `Schema.decodeUnknownEffect` and translate parse failures at
the boundary that owns the recovery decision. Synchronous construction is reserved for trusted
constants, tests, and measured startup or hot paths whose throwing contract is explicit.

A useful error says:

- what failed;
- which safe IDs and versions matter;
- whether retry is safe;
- whether any work completed;
- what the caller can do next.

Every tagged error carries the same guidance fields, spread from `ErrorGuidanceFields` in
`@ue-shed/protocol`:

- `message`: what failed, with the safe IDs and versions that matter;
- `recovery`: prose the caller can follow;
- `retrySafe`: whether repeating the same operation is idempotent;
- `nextStep`: `fix_input`, `retry`, `reconcile` (state changed underneath; re-read first) or
  `escalate` (the caller cannot fix it). `retry` is only valid when `retrySafe` is true.

`pnpm effect:architecture` enforces the fields in each package listed in its error-guidance check;
packages join that list as their errors are migrated.

UI and CLI code must not parse error text to make decisions. Translate library errors at the service
that owns the library. Keep the useful cause.

Use defects only for broken invariants and unknown failures. Keep retries safe, bounded, visible, and
cancellable.
