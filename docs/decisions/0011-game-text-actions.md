# 0011: Game Text actions run in Unreal through an editor plugin

## Status

Proposed on 2026-10-17 for Plan 058 item A3 (decision 10 of that plan). The operation set, places,
verification and failure model below are the contract the `UEShedGameText` editor plugin and the
`@ue-shed/game-text` actions API implement. Engine APIs were checked against UE 5.7's
`Engine/Source`; UE 5.8 still has to be checked (see [Engine APIs](#engine-apis)).

## Context

Game Text finds identity problems (a key that changed, two texts sharing one id, a branch copy
whose text drifted) but cannot fix them. Plan 052 kept key fixes out of scope, and its owner
decision says any fix that writes to assets is applied in Unreal, through its own APIs or a UE Shed
editor plugin where those fall short (ADR 0009 addendum). The only shipped text writes are
DataTable cells through `UEShedAuthoring`. The Game Text identity fixture
(`UEShedGameTextActionsFixture.cpp`) already shows the editor APIs a details panel or graph pin
uses to assign an id.

## Decision

Text actions run inside Unreal, in a separately enabled editor plugin, `UEShedGameText`, called over
stock Remote Control like `UEShedAuthoring`, with a commandlet entry for headless batches. UE Shed
never writes text into a package itself.

### Operations

Each action names one place, the text the caller expects there, and one edit:

| Edit             | Effect                                                                                               | Unreal API                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `change_key`     | Give the text the namespace and key the caller names; source stays                                   | `EditTextProperty_Direct` (Namespace, Key)                   |
| `regenerate_key` | Give the text a new random key; namespace and source stay                                            | `EditTextProperty_Direct` (Key) with `GenerateRandomTextKey` |
| `adopt_key`      | Make the text the same text as another id: its namespace, key and source                             | `EditTextProperty_Direct` (SourceString, Namespace, Key)     |
| `change_source`  | Retype the source as a user would; Unreal keeps the key only if no other text in the package uses it | `EditTextProperty_Direct` (SourceString)                     |

A request then compiles each Blueprint that owns an edited place, and saves the edited packages
only when asked. Re-reading happens in two places: the plugin reads every edited place back after
compiling, and the host re-reads the saved packages with the saved-package reader.

Namespaces on the wire are the user namespace, without the package namespace Unreal adds to text in
packages (`TextNamespaceUtil::StripPackageNamespace`), which is the namespace Unreal's gather and
the saved-package reader report. The plugin re-applies the package's namespace on write, as the
editor does.

### Places

A place is an object path and a property chain, the same form the saved-package reader reports
(`object_path`, `property_path`), so a host can pass a reader occurrence straight through. The
chain may step into structs and fixed or dynamic arrays (`Lines[2]`, `Info.Title`); the last
property must be an `FTextProperty`.

| Place                  | Object                                        | Compiled by                 |
| ---------------------- | --------------------------------------------- | --------------------------- |
| DataAsset property     | The asset                                     | none                        |
| Blueprint CDO variable | `Default__<Class>_C` in the Blueprint package | the owning Blueprint        |
| SCS component template | The node's template, outer'd to the class     | the owning Blueprint        |
| Widget tree            | A widget under the Widget Blueprint's tree    | the owning Widget Blueprint |
| Graph pin              | Waits for Plan 058 A2                         | the owning Blueprint        |

DataTable cells keep using `UEShedAuthoring` (its Apply 1.2 already writes text identity). A
DataTable or graph-pin place is rejected with `unsupported_place` and a way forward. A
representation copy that a compile regenerates (for example a Widget Blueprint class's own widget
tree) fails verification rather than being silently overwritten, because the plugin reads the
place back after compiling.

### Verification

1. **Preflight.** Every place resolves, holds localizable text (not culture invariant, not a String
   Table reference, not generated), and still holds the caller's expected namespace, key and source.
2. **Edit.** Actions apply in request order, so a later action sees an earlier one.
3. **Key check.** `change_key` and `adopt_key` fail with `key_conflict` when Unreal does not keep the
   requested key, which it does when another text in the package already uses that id with
   different source.
4. **Compile.** Each owning Blueprint compiles once; a compile error fails the request.
5. **Read back.** Each place is read again after compiling and must hold the result the action
   reported.
6. **Save** (optional), then the host re-reads the saved packages with the saved-package reader and
   compares each place against the reported result. Unreal's gather stays the final reference: the
   acceptance tests compare re-read ids with a gather of the fixture.

A dry run performs steps 1 to 3 against the live objects and then restores every edited value and
each package's dirty flag, so it reports the same results and conflicts an apply would, without
compiling or saving. A key that would be minted is reported as `minted` with no value.

### Failure model

A request is all or nothing. A request that fails validation, preflight or the key check changes
nothing (edits made before the failing action are restored, with each package's dirty flag) and
reports `status: "rejected"`. When a compile or read-back fails, the plugin restores every edited
value, recompiles the Blueprints it compiled and restores dirty flags, then reports
`status: "failed"` with `rolledBack: true`. Save failures after a successful compile leave the
edits in memory (the editor's state is still consistent), report `failed` with `rolledBack: false`
and list which packages were saved.

Errors have a stable `code`, the action they belong to, `message`, `recovery`, `retrySafe` and a
typed `nextStep` (`fix_input`, `retry`, `reconcile`, `escalate`), the error shape Plan 058 lane D
adopts:

| Code                | Next step   | Meaning                                                              |
| ------------------- | ----------- | -------------------------------------------------------------------- |
| `invalid_request`   | `fix_input` | The request does not match the contract or its bounds                |
| `place_not_found`   | `reconcile` | The object or property chain no longer exists; rescan                |
| `not_text`          | `fix_input` | The property chain does not end in a text property                   |
| `read_only_text`    | `fix_input` | Culture-invariant, String Table or generated text has no key to edit |
| `unsupported_place` | `fix_input` | DataTable cell (use authoring) or graph pin (not yet)                |
| `stale_expected`    | `reconcile` | The live text differs from what the caller reviewed; rescan          |
| `key_conflict`      | `fix_input` | Unreal would not keep the requested key in this package              |
| `compile_failed`    | `escalate`  | An owning Blueprint failed to compile; edits were rolled back        |
| `not_persisted`     | `escalate`  | A place did not hold its result after compiling; rolled back         |
| `save_failed`       | `retry`     | A package could not be saved (for example a read-only file)          |

UE Shed never checks files out (ADR 0009): a dry run lists the packages an apply may write so a
host can check them out first.

### Engine APIs

Checked in UE 5.7 `Engine/Source`; the UE 5.8 follow-up must check the same list:

- `TextNamespaceUtil::EditTextProperty_Direct`, `GetTextIdForEdit`, `ETextEditAction`,
  `GenerateRandomTextKey`, `GetPackageNamespace` (`CoreUObject/Public/Internationalization/TextPackageNamespaceUtil.h`);
- `TextNamespaceUtil::StripPackageNamespace` (`Core/Public/Internationalization/TextNamespaceUtil.h`);
- `FTextInspector::GetTextId`, `GetSourceString`, `FText::IsCultureInvariant`, `IsFromStringTable`;
- `FKismetEditorUtilities::CompileBlueprint`, `UBlueprint::GetBlueprintFromClass`, `UBlueprint::Status`;
- `UPackage::SavePackage` with `FSavePackageArgs`.

## Consequences

- Hosts get key fixes without UE Shed writing packages, and the editor's own id rules apply.
- The plugin is optional and capability-advertised (`gameTextObjectPath` and the
  `game-text.actions.v1` capability in the core manifest) and allow-listed for Remote Control.
- Graph pins join once A2 makes them Game Text places; their edit uses
  `UEdGraphSchema_K2::TrySetDefaultText`.
- A request edits at most 256 places, so one dry run or apply stays bounded.
