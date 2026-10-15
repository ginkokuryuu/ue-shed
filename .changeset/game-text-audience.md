---
"@ue-shed/game-text": minor
"@ue-shed/protocol": minor
"@ue-shed/unreal-assets": minor
"@ue-shed/uasset": minor
"@ue-shed/uasset-win32-x64": minor
---

Tell player text from editor text in Game Text.

Every text occurrence now records its `audience` (`player`, `editor` or `unknown`), why
(`audienceReason`) and the policy row that decided it (`audienceRule`). Unreal's own evidence comes
first: uasset-io v1.11 adds `gather_editor_only` to package text record occurrences, the editor-only
bit Unreal saved for that text in the package's gatherable text table. Otherwise the reviewed,
studio-agnostic `TEXT_AUDIENCE_POLICY` table decides (reflection tooltips, Blueprint, animation,
Niagara and material graph nodes, editor modules, tooltips and categories, the UMG palette
category and Niagara script metadata are editor text; String Table entries, DataTable cells,
Blueprint enum display names and widget designer trees are player text). Units, search results and
localization lines roll their visible occurrences up: player if any is, else unknown if any is,
else editor.

Search and query requests take an `audience` filter clause, `facets.audiences` and
`group: "audience"`; Workbench's Filter and Display menus offer them. `gameTextCsv` and
`localizationLinesCsv` add an Audience column. With a target that does not gather editor-only data
(`ShouldGatherFromEditorOnlyData`, false by default), editor text that would read "Not gathered
yet" is "Outside this target" with `outOfScope: "editor_only_data_not_gathered"`, so localization
checks skip it; lines outside the gather paths carry `outside_gather_paths`.

The package text index format moves to `package-text-v4` and joins to `joined-v13`, so existing
caches read their packages once more. The audience policy is part of each shard key, so later
policy changes re-encode stored shards without reading packages again.
