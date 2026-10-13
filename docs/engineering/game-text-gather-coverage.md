# Game Text coverage compared with Unreal gather

Game Text's headless rescan reads saved package evidence and previously generated localization
files. It does not run a fresh Unreal gather. When a supported gather operation is explicitly run,
UE Shed launches Unreal's own commandlets and then reads their outputs; that operation has the
coverage of the selected Unreal recipe, not just the saved-package parser.

## What a headless rescan can miss

| Source or behavior                                    | Current saved-scan limitation                                                                                                                                                                                                                                                                                   | What a fresh Unreal gather adds                                                                                                                                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C++ and INI text                                      | No source macro or INI parser. New, changed and removed `LOCTEXT`, `NSLOCTEXT`, UI-command and localized log text cannot be discovered from those files.                                                                                                                                                        | The source commandlet parses its configured files, namespaces, macro wrappers and conditional/editor-only context.                                                                                                         |
| Code-defined and CSV String Tables                    | Saved String Table assets are decoded. Code definitions, `LOCTABLE` entries and CSV files loaded by `LOCTABLE_FROMFILE_GAME` or `LOCTABLE_FROMFILE_ENGINE` are not independently read. References cannot manufacture a missing definition.                                                                      | The source commandlet collects definitions and loads the referenced CSV data.                                                                                                                                              |
| Reflected metadata                                    | The text projection emits no lines for `DecodedAsset::Enum`; it does not evaluate configured metadata input keys, output namespaces and key patterns over reflected fields.                                                                                                                                     | Configured metadata gathering can collect enum names, display names, tooltips and other metadata. In 5.8, asset gathering can also use the metadata helper.                                                                |
| Blueprint script bytecode                             | Supported graph/pin text is read, but the scan does not run Unreal's script-bytecode gatherer. A literal in a compiled function or Level Blueprint can therefore be missing even when graph properties were decoded.                                                                                            | Unreal walks script text constants when loading the package. Saved gather caches cannot reliably replace this step for bytecode-bearing assets.                                                                            |
| Custom gather callbacks and unsupported serialization | The parser reads supported saved representations; it does not execute project/plugin class or struct callbacks, load-time initialization or arbitrary native serialization. Unsupported text histories and version-gated containers can also hide text. Dialogue/voice workflows are outside the product scope. | Unreal loads the applicable classes/modules and invokes its reflection and type-specific gather behavior.                                                                                                                  |
| Plugin and engine content roots                       | The default Project Index inventory enumerates the project's `Content` directory. It does not inventory `Plugins/<plugin>/Content`, installed plugin content or engine content as additional mounted roots. Explicit lower-level reads can differ from the default inventory.                                   | A configured gather can select assets through Unreal's mounted roots and Asset Registry.                                                                                                                                   |
| Exact gather inclusion and context                    | Scope inference handles project-relative paths, filename patterns and some class exclusions. It lacks complete reflected ancestry and per-site editor-only, optional, platform and custom-context decisions. Unavailable class/settings evidence produces unknown reasons where modeled.                        | Unreal applies the actual recipe, reflected flags, archetype/default comparisons, manifest dependencies and source-site context. This can exclude text that our broad saved scan shows, as well as include text it misses. |

Previously gathered text from these sources is still visible when the selected target's readable
manifest supplies it. It is evidence from that gather, not proof of the current source file. For
example, a new C++ line remains invisible until gathered; an edited C++ line can continue to show
its old manifest text. Reading an archive or PO file does not independently discover new source.
Asset-origin evidence can acquire unknown/not-found states under the existing join rules; every
unmatched line should not be assumed to be gathered-only.

## Coverage and diagnostics

`complete` describes the selected saved-package scan and its modeled decoder gaps. It does not
certify parity with every Unreal gather source. Known unsupported histories, rejected decoders,
unavailable engine features and legacy containers produce coverage gaps. Excluded packages have
`not_gatherable`, which does not prove the absence of text.

There are also blind spots outside those counters: source files are not scanned, default inventory
omits other mounted content, compiled bytecode is not traversed, and custom callbacks are not run.
Modern opaque export tails and generic unsupported values do not all become text-specific gaps.
Zero findings or zero reported decoder gaps therefore cannot certify complete localization coverage.

The scan can display culture-invariant or unresolved saved text that Unreal intentionally does not
gather. Empty/whitespace-only text and String Table references are also not independent gathered
sources. More saved occurrences than manifest lines is not by itself a gather defect.

Unsaved editor changes and arbitrary runtime/server-generated strings are outside the saved scan.
A normal separate-process Unreal gather is not an audit of unsaved editor memory or every string
that can appear during play either. Rendered width, culture fallback and runtime localization
loading require separate runtime validation.

## Practical workflow and next improvements

Use rescan for supported saved assets, fast search and source-to-manifest drift. Use a fresh Unreal
gather before certifying target completeness or treating source-code changes as checked. UE Shed's
operation planner supports standard source, asset and metadata recipes; custom commandlets,
platform-split output and gather-cache repair/report recipes are currently rejected. Such recipes
must run through their existing Unreal workflow and their generated evidence can then be refreshed.

The next coverage work should first expose these source boundaries in reports and compare the
headless identity/source set with fresh 5.7 and 5.8 gather output. Extend the shared Project Index
for mounted roots instead of adding another feature-owned enumerator. A bounded source/CSV reader
would improve pre-gather review. Reading saved gatherable-text payloads would add engine-authored
site/context evidence, but those caches can be stale and do not solve Blueprint bytecode. Bytecode
and custom callbacks need dedicated support or an explicitly requested Unreal gather.

These are proposed follow-ups, not changes implemented by the performance work.

## Evidence

This comparison was checked against both locally installed UE 5.7 and UE 5.8 sources on 2026-10-13:

- `Editor/UnrealEd/Private/Commandlets/GatherTextFromSourceCommandlet.cpp`:
  `GetParsables`, String Table/CSV descriptors and INI handling.
- `Editor/UnrealEd/Private/Commandlets/GatherTextFromAssetsCommandlet.cpp`:
  package loading, external actors, class exclusions and source-site processing.
- `Runtime/CoreUObject/Private/Serialization/PropertyLocalizationDataGathering.cpp`:
  type-specific callbacks, reflected properties, archetype comparisons and script-bytecode text.
- `Editor/UnrealEd/Private/Commandlets/GatherTextFromMetadataCommandlet.cpp`, plus 5.8's
  `Editor/UnrealEd/Private/GatherTextMetaDataHelper.cpp`: reflected metadata gathering.

Repository evidence: [default inventory](../../crates/uasset-io/src/direct_executor/scanner/discovery.rs),
[text projection](../../crates/uasset-inspection/src/projection.rs),
[text decoder](../../crates/uasset-parser/src/codec.rs),
[candidate selection](../../packages/game-text/src/package-text-candidates.ts),
[scope inference](../../packages/game-text/src/localization.ts) and
[operation planning](../../packages/localization/src/operation-plan.ts).

Epic's [pipeline optimization guide](https://dev.epicgames.com/documentation/en-us/unreal-engine/pipeline-optimization-for-localization-in-unreal-engine)
explains saved gather caches, the bytecode exception and intentionally nongathered text.
Its [localization tools guide](https://dev.epicgames.com/documentation/en-us/unreal-engine/localization-tools-in-unreal-engine)
and [localization overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/localization-overview-for-unreal-engine)
describe target recipes and the generated manifest/archive/resource pipeline. This was a source
comparison, not a new exhaustive project gather or a fresh engine conformance run.
