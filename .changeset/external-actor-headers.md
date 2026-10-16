---
"@ue-shed/game-text": patch
---

Game Text scans read an external actor or object package only when its saved header says it holds gatherable text, as Unreal's gatherer does. Before, every external package and its world were read. On a large World Partition project this cuts a scan from 429,625 packages (16.4 GB) to 9,056 (4.7 GB). Projects without external packages select the same packages as before.
