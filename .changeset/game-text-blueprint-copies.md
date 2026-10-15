---
"@ue-shed/game-text": minor
"@ue-shed/protocol": minor
"@ue-shed/unreal-assets": minor
"@ue-shed/uasset": minor
"@ue-shed/uasset-win32-x64": minor
---

Fold compiled Blueprint copies into the text a Blueprint authored.

Compiling a Blueprint saves its widget tree, animations and defaults again under the generated
class (`WBP_X_C`, animations as `Name_INST`), its default object (`Default__WBP_X_C`) and sometimes
a skeleton class (`SKEL_WBP_X_C`). Game Text listed each widget text twice, and a Blueprint edited
but not compiled read as "Same key, different text".

uasset-io v1.12 adds `blueprintClasses` to package text records: each Blueprint, the export its saved
`GeneratedClass` names, that class's `RF_ClassDefaultObject` export, and a saved skeleton class and
its default object. Game Text folds every copy into the occurrence at its authored site with the
same property and key, keeping two same-key properties of one object as two places and leaving
sites saved only under the class (such as construction-script nodes) as their own places. Nothing
is folded from names alone, so an asset whose own name ends in `_C` is untouched.

Each place keeps the authored text as its source and lists its copies in `copies` (`objectPath`,
`kind`: `generated_class`, `instance`, `class_default` or `skeleton`, and `source`). Counts,
search, facets, exports, localization joins and the index follow the places. A copy with other text
no longer makes its key conflicting; the unit gets the `compiled_copy_differs` review signal
("Blueprint not compiled since edit"), and the Workbench line page says what the game shows. A
place's audience rolls up over the place and its copies.

The package text index format moves to `package-text-v5` and joins to `joined-v14`, so existing
caches read their packages once more.
