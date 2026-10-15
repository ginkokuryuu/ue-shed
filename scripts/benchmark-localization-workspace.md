# Localization quality workspace stalls

Build the TypeScript packages, then run from the repository root:

```powershell
pnpm run build:typescript-packages
$env:UE_SHED_WORKSPACE_STALL_CHECK = "1"
node --import tsx --max-old-space-size=12288 scripts/benchmark-localization-workspace.ts 238000
```

This creates an isolated synthetic saved-text corpus, manifest and ten archives under
`test-results/stall`, builds the production index, and runs the indexed source and localization
quality scans. The fixture scope removes its own generated directory on normal completion.
It never invokes Unreal or the native asset reader. Smaller line counts support quick iteration.

Measurements start after scanning: construction, first and distant pages, source terminology,
partly reconciled placeholders, and native/translated culture selections. Each measured operation
is synchronous; the reused 10 ms event-loop probe also counts the final open gap. Effect yields
separate operations. JSON lines include elapsed time, maximum gap, sampled heap and page hashes.
With `UE_SHED_WORKSPACE_STALL_CHECK=1`, any measured operation exceeding 250 ms fails the command.
Run this timing gate separately from the test suite on an otherwise quiet machine.

Set `UE_SHED_WORKSPACE_SOURCE_PREFIX=Label1` to limit the rules' role to matching property names.
This keeps the same large corpus and cultures while producing fewer source findings; apply the
same setting to both implementations when comparing timings and hashes.

The `true`/`false` stage suffix means source report present/omitted. Both cases reuse the same
localization scan made with the rule document; `false` isolates workspace reconciliation and is
not a scan without a rule document. Source rules cover all labels with a character budget and
forbid TODO. Sources rotate between TODO, TODO + FIXME, FIXME and finished text, exercising full,
partial and absent placeholder reconciliation. Translation rules add a German character budget.

An optional third argument is a saved workspace implementation's module path, for comparison
against an earlier revision. Save that revision's `localization-workspace.ts` beside the current
file as `localization-workspace-baseline.test-support.ts` so its relative imports resolve, then
pass that path. Remove it after measuring. Disable the timing gate for the baseline. Keep the
same generator, line count, cultures and scan inputs, and compare the result hashes.

Index preparation and scans can be much slower than the measured workspace operations. Heap
samples are taken after operations, so they are not a measurement of transient peak heap.
Full synchronous exports and the preexisting scan/preparation costs are outside this timing gate.
