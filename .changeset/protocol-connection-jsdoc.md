---
"@ue-shed/protocol": patch
"@ue-shed/unreal-connection": patch
---

Document every public export of `@ue-shed/protocol` and `@ue-shed/unreal-connection` (Plan 058 D11). Each schema, decoder and service now says what its signature cannot show: what it means on the wire or in Unreal, units and bounds, which contract or protocol version it belongs to, and how decoding fails. Failures are described in prose, not as `@throws`.

A new lint rule, `anti-slop/require-jsdoc-on-exports`, is enabled for both packages and keeps them documented. Re-exports are covered at their declaration, and a type or interface named after a documented schema constant shares its documentation. Four files that lane D4 is rewriting are exempt until it lands: `protocol/src/index.ts`, `protocol/src/error-guidance.ts`, `unreal-connection/src/index.ts` and `unreal-connection/src/remote-control-client.ts`.

No API changes.
