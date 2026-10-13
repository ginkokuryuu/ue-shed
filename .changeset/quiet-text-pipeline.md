---
"@ue-shed/game-text": patch
"@ue-shed/unreal-assets": patch
---

Share scoped query workers across overlapping immutable index readers. Workbench prepares one
target-first model for source and localization browsing, validates inputs before reusing it, and
retains unchanged workers across rescans. Keep result rows and loaded pages stable with Solid 2 keys.
Expose an optional opaque query identity on validated target handles and their opened models so
hosts can reuse a model without constructing storage identifiers. Correct Game Text's Node range
to `^22.15.0 || >=23.8.0`, matching the built-in Zstd APIs required by its Node entry point.
Replace failed query workers on unchanged refreshes while preserving healthy sharing and existing
reader pins; retiring a failed worker cannot evict its replacement.

Reduce saved-text extraction working memory with bounded ordered native delivery and concurrent
path validation. Keep package signature checks before and after reads while running them with
bounded concurrency. Warm bounded query pages instead of every column, reduce source-arena
retention, and accelerate Unicode search rejection, quality evaluation and raw-unit focus.

Start cold localization parsing with input-size memory reservations rather than a blocking
largest-file probe. Prepare bounded string-sort runs in workers, batch large cold package reads,
convert larger staged layers in workers, and retain only two decoded identifiers while sorting
joined query IDs. Small package sets and small layer mappings keep their existing preparation path.

Persist a bounded optional source-query projection so reopened readers can reuse verified source
bytes, ASCII flags and trigram membership. Preserve pinned readers and update the projection across
source overlays. Match review records by numeric identity and sort joined identifiers in bounded
locale runs with a stable merge.
