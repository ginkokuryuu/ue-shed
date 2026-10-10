import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// The local run reuses the normal test so fixes cannot diverge between CI and local fuzzing.
const count = Number(process.argv[2] ?? 10000),
	start = Number(process.argv[3] ?? 0);
if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(start) || start < 0)
	throw new Error("Usage: node scripts/fuzz-columnar-join.ts [seed-count] [first-seed]");
const result = spawnSync(
	process.execPath,
	[
		resolve("node_modules/vitest/vitest.mjs"),
		"run",
		"--disableConsoleIntercept",
		"scripts/columnar-join-fuzz.test.ts"
	],
	{
		env: {
			...process.env,
			UE_SHED_JOIN_FUZZ_SEEDS: String(count),
			UE_SHED_JOIN_FUZZ_START: String(start)
		},
		stdio: "inherit",
		windowsHide: true
	}
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
