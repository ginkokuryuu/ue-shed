---
"@ue-shed/uasset": patch
---

Read graph pins whose default text is a String Table reference (FText history 11). The Blueprint graph reader decoded every other pin text but reported these as an unsupported history, so a Blueprint with such a pin was read only in part. It now reads them as tagged text properties are read: table ID and key, with no saved source. The Game Text identity fixture's new slice 2 (Plan 058 A4) found the gap. That slice adds String Tables, compiled literals of each saved kind, Blueprint inheritance, a level actor and a World Partition external actor, checked against Unreal 5.7's gather.
