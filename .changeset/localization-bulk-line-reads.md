---
"@ue-shed/game-text": patch
---

Read localization lines in bulk without re-decoding evidence for every entry.
`localizationLines` used to hydrate one line per page. Each manifest, archive and PO entry
re-decoded its file's metadata and zstd string blocks. On a 238k-line, 10-culture target that took
over 40 minutes before it ran out of memory.

- Bulk reads now hydrate rows in storage order, in pages of adjacent rows (bridging small gaps), and
  return them in the requested order.
- Multi-line pages decode each evidence file's rows in sorted runs once per page.
- Shared string lookups decode in ID order, so each block is decompressed once per lookup.

Single-line browsing is unchanged.
