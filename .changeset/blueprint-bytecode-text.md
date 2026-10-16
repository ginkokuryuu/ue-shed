---
"@ue-shed/uasset": patch
"@ue-shed/game-text": patch
---

Read the text literals compiled into Blueprint functions. The reader now walks every saved `UFunction`'s script bytecode (UE 4.27 to 5.8) and reports each `EX_TextConst` as a `ScriptBytecode` place, so Print Text and other graph literals that Unreal gathers are no longer silently missing; a script the walk cannot follow is a decode error. Function parameters of delegate and field-path types are now read too. Game Text classifies compiled literals as player text (`script_bytecode`).
