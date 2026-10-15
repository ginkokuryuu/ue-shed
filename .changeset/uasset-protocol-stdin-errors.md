---
"@ue-shed/unreal-assets": patch
---

Report a native reader that closes its input pipe early (EOF/EPIPE) as a typed process failure
instead of an unhandled stream error that crashes the host, and reject one-shot protocol requests
over the native reader's 4 MiB frame limit before spawning the worker.
