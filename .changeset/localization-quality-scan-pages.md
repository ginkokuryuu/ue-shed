---
"@ue-shed/game-text": patch
---

Hydrate localization lines and scan localization quality about twice as fast, in shorter pauses.

- A page of lines reads its columns, evidence entries and strings once, then builds its lines
  without per-entry Effect or schema work.
- Evidence entries read from the index are no longer schema-decoded one by one. The importer
  validates Unreal's files when it writes the index, and checksums guard the index's bytes.
- The quality scan checks 256 lines per page and yields after each, and while it prepares line
  order. On a generated 583,507-line, 10-culture target the longest pause fell from 4–5 s to
  0.5–0.7 s, and the scan from about 205 s to 115 s.
