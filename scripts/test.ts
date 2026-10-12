import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureUassetExecutable, repositoryRoot } from "./native-tools.ts";
import { reportPerforceMapHistoryTestGate, reportUnrealTestGates } from "./test-gates.ts";

const withoutUassetFlag = "--without-uasset";
const uassetAutoBuildEnvironment = "UE_SHED_UASSET_AUTO_BUILD";
const testArguments = process.argv.slice(2);
const withoutUasset = testArguments.includes(withoutUassetFlag);
const vitestArguments = testArguments.filter((argument) => argument !== withoutUassetFlag);
const vitest = join(repositoryRoot, "node_modules", "vitest", "vitest.mjs");
const environment: NodeJS.ProcessEnv = { ...process.env };
delete environment.UE_SHED_PACKAGE_TEXT_FIXTURE_CACHE;
let fixtureCache: string | undefined;
if (withoutUasset) {
	delete environment.UE_SHED_UASSET_EXECUTABLE;
	environment[uassetAutoBuildEnvironment] = "0";
} else {
	environment.UE_SHED_UASSET_EXECUTABLE = ensureUassetExecutable();
	fixtureCache = mkdtempSync(join(tmpdir(), "ue-shed-test-evidence-"));
	environment.UE_SHED_PACKAGE_TEXT_FIXTURE_CACHE = fixtureCache;
}
try {
	reportUnrealTestGates(environment, vitestArguments);
	reportPerforceMapHistoryTestGate(environment, vitestArguments);
	const result = spawnSync(process.execPath, [vitest, "run", ...vitestArguments], {
		cwd: repositoryRoot,
		env: environment,
		stdio: "inherit",
		windowsHide: true
	});

	if (result.error) throw result.error;
	process.exitCode = result.status ?? 1;
} finally {
	if (fixtureCache) rmSync(fixtureCache, { recursive: true, force: true });
}
