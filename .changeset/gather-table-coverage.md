---
"@ue-shed/protocol": minor
"@ue-shed/unreal-assets": minor
"@ue-shed/game-text": minor
"@ue-shed/uasset": minor
"@ue-shed/uasset-win32-x64": minor
"@ue-shed/uasset-inspection-wasm": minor
---

Saved text coverage now follows the package's own gatherable text table, the list Unreal's asset
gather reads. A package is partial only when a runtime entry from that table was not decoded;
undecodable properties that hold no gatherable text (native Niagara structs, for example) remain
reported as coverage gaps without making the package partial. The table is used only where Unreal's
gather would use it; Blueprints with bytecode, which are saved without one, keep the previous
decoder-gap rule. uasset-io v1.10 adds `gatherCoverage` to package text records, Game Text adds
`coverage.missingGatherableText` and `gatherable_text_not_decoded` diagnostics with the unread
source text and Unreal site, and user-defined enum display names are now read as text. Entries
match on namespace, key and source text, so an unread source variant under a decoded key stays
missing, and authored bracketed namespaces are compared as Unreal saved them. UE 5.8 user-defined
enums, which save an extra underlying-type byte, now decode instead of failing.
