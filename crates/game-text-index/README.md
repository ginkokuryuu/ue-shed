# Game Text index writer

Native library for the opt-in `nativeIndexBuilderLayer` in `@ue-shed/game-text`. The existing
`uasset-io protocol-session` exposes its typed operations at protocol version 1.13; it does not
require another executable. This crate never reads Unreal projects or launches editors.

TypeScript producers continue to own package extraction and localization import. Rust owns the
leased dictionary writer, immutable layer publication, joined projections and compaction. The
format-4 store and JavaScript query readers remain the same. Package selection still uses each
package's own header; no outer-world relationship is added to Game Text candidate selection.

Native joined keys use a separate namespace so switching builders rebuilds the joined view once
without reusing incompatible physical column projections. Input layers remain reusable. Selected
reads verify consumed payload checksums; they do not scrub every unused cached payload.

From the repository root:

```sh
cargo test --locked -p game-text-index
cargo clippy --locked -p game-text-index --all-targets -- -D warnings
node scripts/test.ts packages/game-text/src/native-index-builder.integration.test.ts scripts/native-game-text-join.test.ts
```

See [the host and implementation guide](../../docs/engineering/native-game-text-index.md) for
composition, fallback conditions, bounds and measurement scope.
