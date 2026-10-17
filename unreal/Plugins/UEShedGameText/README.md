# UEShedGameText

The separately enabled editor capability for Game Text identity actions (ADR 0011). It changes,
regenerates and adopts text keys and retypes source in assets through
`TextNamespaceUtil::EditTextProperty_Direct`, the function a details panel uses, so Unreal's own id
rules decide which key a text keeps. UE Shed never writes text into a package itself.

`ApplyTextActions(RequestJson, ResultJson)` implements `ue-shed-game-text-actions` 1.0
(`packages/protocol/contracts/game-text/v1`). The core capability manifest advertises
`gameTextObjectPath` and `game-text.actions.v1` when the module is loaded. Headless batches run the
same request through the commandlet:

```text
UnrealEditor-Cmd <project> -run=UEShedGameText -Request=<request.json> -Result=<result.json>
```

The commandlet exits `0` when the result's status is `ok`, `1` when the request was rejected or
failed, and `2` when it could not read the request or write the result.

## Places

A place retains `packageFile` (absolute or relative to the connected editor project), the saved
object path and the reader's property chain: struct members joined by
`.`, fixed and dynamic array elements as `[n]`, and map values as `{n}.value`. The chain must end in
a text property. DataAsset properties, Blueprint class defaults, SCS component templates and widget
trees are supported. DataTable cells are rejected with `unsupported_place` (use `UEShedAuthoring`
Apply 1.2), as are graph nodes until Plan 058 A2.

## Edits

| Edit             | Unreal edit actions                                           |
| ---------------- | ------------------------------------------------------------- |
| `change_key`     | Namespace, then Key                                           |
| `regenerate_key` | Key, with `TextNamespaceUtil::GenerateRandomTextKey`          |
| `adopt_key`      | SourceString, Namespace, then Key                             |
| `change_source`  | SourceString (Unreal keeps the key only for a sole reference) |

The plugin resolves the file through Unreal's mounted content, then resolves the object within that
package and verifies its owner. A copied file may retain its original serialized package prefix;
this never redirects the edit to that original. Missing or ambiguous bindings fail with
`package_mismatch`. Keep the same file path convention when re-reading for verification.

Namespaces on the wire leave out the package namespace; Unreal re-applies it on write.
`change_key` and `adopt_key` fail with `key_conflict` when Unreal does not keep the requested key
because another text in the package uses that id with different source.

## Verification and failures

Every place must resolve, hold localizable text and still hold the expected namespace, key and
source; otherwise nothing changes and the result is `rejected`. Actions apply in order. A dry run
applies, checks, then restores every value and each package's dirty flag. Normal and rollback
compiles use `SkipSave`, independently of the editor's Save on Compile preference. An apply reads
every place back; compile or verification failures restore edits, recompile and verify restoration
before reporting `rolledBack: true`. Failed restoration reports `rollback_failed` and unknown
outcomes requiring reconciliation.

Saving packages is not atomic. A save failure leaves edits applied, with their generated keys and
file-bound places in the receipt. Package results distinguish `saved`, `unsaved` (no write attempted)
and `unknown` persistence. `save_failed` has `retrySafe: false`, `nextStep: reconcile`: inspect live
text and saved bytes, resolve checkout/disk failures, then explicitly save the reviewed outstanding
state through Unreal. Never replay the edits to recover persistence. Successfully saved actions
remain eligible for `verifyGameTextActions` even when another package failed. A lost mutation reply
also requires reconciliation. UE Shed never checks files out.

Native automation tests `UEShed.GameText.ObjectProperties` and `UEShed.GameText.Blueprint` plus `UEShed.GameText.SaveRecovery` cover
every edit, dry run, conflicts with rollback, struct, array, map and fixed-array places, read-only
and unsupported places, malformed requests, and a Blueprint class default and component template
that keep their edits through a compile. They also check disk bytes with Save on Compile enabled,
post-compile verification rollback, and partial-save recovery without generating another key. `pnpm test:unreal-game-text-actions` drives the fixture's
identity cases through Remote Control on a copy of the fixture project and compares the re-read ids
with Unreal's gather table.
