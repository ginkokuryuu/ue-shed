# Canonical WTF-8 golden fixtures

`golden.json` records UTF-16 code units and exact bytes. The `.bin` files contain those bytes, with no header. Format version 4 uses magic `UESHT004`. The native builder copies these fixtures byte for byte until the branches merge.

`typescript.snapshot` is an uncompressed TypeScript-written v4 snapshot containing the five valid values in `golden.b0` and their domain starts in `golden.starts`. `rust.snapshot` was written by the native builder's `--mode wtf8-golden` command after reading `typescript.snapshot`. Both files are read by the TypeScript golden test, which verifies the exact UTF-16 code units. The native command also reports the decoded units in `test-results/codex/phase6-wtf8-rust-interop.log`.
