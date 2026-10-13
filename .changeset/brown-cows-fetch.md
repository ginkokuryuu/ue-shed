---
"@ue-shed/cameras": minor
"@ue-shed/protocol": minor
---

Add composable map source planning, lossless RGBA8 cropping, and linear-light parent derivation.
Callers can choose individual tile captures or larger source blocks per zoom with explicit size
and decoded-memory limits, while retaining control of rendering, codecs, scheduling and publication.

Expose optional, capability-checked screenshot warmup frames on the editor-viewport renderer.
Native screenshot warmup is separate from outer settling; the scoped override restores the original
engine value and priority after each frame and on interruption. Extended capability discovery is
explicitly negotiated; the original capability response remains compatible with strict v1 clients.
Existing capture defaults remain intact.
