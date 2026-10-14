---
"@ue-shed/engine": patch
---

Launch UE4 projects. The project launcher and supervised editor sessions now use `UE4Editor`
binaries and `UE4Editor.modules` manifests for 4.x engines instead of always expecting
`UnrealEditor`, so 4.27 launches no longer fail with `editor_missing` or report the Remote Control
check as unverifiable. `unrealEditorExecutable`, `validateUnrealProjectBuildId`, and
`validateUnrealRemoteControlBuild` take an optional `EngineVersion`; omitting it keeps UE5 naming.
On macOS, `unrealEditorExecutable` now returns the binary inside the editor's app bundle
(`UE4Editor.app/Contents/MacOS/UE4Editor` or `UnrealEditor.app/Contents/MacOS/UnrealEditor`)
instead of a bare path that Unreal installations don't have.
