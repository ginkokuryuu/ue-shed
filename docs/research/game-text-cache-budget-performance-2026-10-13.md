# Game Text cache allowance experiment — consolidated

This investigation is now part of the [consolidated experiment record](game-text-pipeline-performance-2026-10-13.md).
The accepted retained 1× cache is **81.8 MiB**, up from **79.1 MiB**. Its repeated comparison
remains **72.55 → 69.14 seconds** cold and **3.347 → 2.450 seconds** reopening. Raw samples are
under `phases.cacheAllowance` in the consolidated JSON; original evidence is available at commit
`5332c6e1` and in the local evidence archive.

The maintained decision is [ADR 0010](../decisions/0010-game-text-performance-policy.md).
