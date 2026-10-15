---
"@ue-shed/game-text": patch
---

Report progress from the indexed localization quality scan.

An opened index model's `localizationQuality` options take `onProgress`, called with
`LocalizationQualityProgress` (`{ checkedLines, totalLines, findings }`) once before the scan and
after each 256-line page, so hosts can show how far a long scan has got. Results are unchanged.
