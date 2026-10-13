# Game Text cold index continuation — consolidated

This investigation is now part of the [consolidated experiment record](game-text-pipeline-performance-2026-10-13.md).
Its repeated comparison remains **83.63 → 71.25 seconds**, with sampled peak Node RSS
**2,610.5 → 2,416.1 MiB** on retained generated 1× records, excluding native extraction.
Raw samples are under `phases.coldPreparation` in the consolidated JSON; original evidence is
available at commit `5332c6e1` and in the local evidence archive.

The maintained decision is [ADR 0010](../decisions/0010-game-text-performance-policy.md).
