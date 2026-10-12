---
"@ue-shed/localization": minor
"@ue-shed/game-text": patch
---

Share typed localization failure recovery between the event reader and streamed index importer.
Malformed manifests, archives and PO files retain the existing recovery guidance through indexed
CLI and Workbench workflows, with file and position details from the streaming reader.
