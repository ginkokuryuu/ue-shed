---
"@ue-shed/game-text": patch
---

Index steps and the refresh layer take `qualityWorker: true`, which runs localization quality scans in a worker per opened model instead of on the host's thread. The returned `LocalizationQuality` behaves the same: facts and groups are local, and `items`, `find`, `lineOfUnit` and `sourceKeyOfUnit` read the worker's scan synchronously. Progress callbacks and interruption work as before. If the worker cannot start or fails, the scan runs on the host. The option is off by default; the Workbench turns it on. New exported type: `GameTextIndexStepsOptions`.
