import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_VERSION } from "./pack-public-packages.ts";
import { assertCleanReleaseSource, changedFilesSince } from "./release-source.ts";

const repositoryRoot = resolve(import.meta.dirname, "..");

export interface ReleaseSteps {
	readonly validateSource: () => string;
	readonly check: () => void;
	readonly confirm: () => Promise<void>;
	readonly publish: () => void;
	/** Reuse a `pnpm check` the operator already ran instead of rerunning the gate. */
	readonly reuseCheck?: ReusedCheck | undefined;
}

export interface ReusedCheck {
	/** Full commit the operator gated with `pnpm check`. */
	readonly commit: string;
	/** The only file allowed to change between the checked commit and the release HEAD. */
	readonly releaseNotes: string;
	/** Files changed from the checked commit to HEAD; throws if it is not an ancestor. */
	readonly changesSince: (commit: string) => readonly string[];
}

export async function runRelease({
	validateSource,
	check,
	confirm,
	publish,
	reuseCheck
}: ReleaseSteps) {
	const validatedCommit = validateSource();
	if (reuseCheck === undefined) check();
	else assertReusableCheck(reuseCheck, validatedCommit);
	await confirm();
	const publicationCommit = validateSource();
	if (publicationCommit !== validatedCommit) {
		throw new Error(
			`Release source changed from ${validatedCommit} to ${publicationCommit} during validation.`
		);
	}
	publish();
}

export function assertReusableCheck(
	{ commit, releaseNotes, changesSince }: ReusedCheck,
	head: string
) {
	if (!/^[0-9a-f]{40}$/.test(commit)) {
		throw new Error(`--checked requires a full 40-character commit, received ${commit}.`);
	}
	if (commit === head) return;
	const unchecked = changesSince(commit).filter((file) => file !== releaseNotes);
	if (unchecked.length > 0) {
		throw new Error(
			`--checked ${commit} differs from release HEAD ${head} beyond ${releaseNotes} ` +
				`(${unchecked.join(", ")}); rerun pnpm check.`
		);
	}
}

export function parseReleaseArguments(args: readonly string[]) {
	const { values } = parseArgs({
		args: [...args],
		options: { checked: { type: "string" } },
		strict: true
	});
	return { checkedCommit: values.checked };
}

export function publicationConfirmationPhrase(version: string) {
	return `publish ${version}`;
}

export function assertPublicationConfirmation(answer: string, version: string) {
	const expected = publicationConfirmationPhrase(version);
	if (answer !== expected) {
		throw new Error(
			`Release publication aborted: expected the exact phrase ${JSON.stringify(expected)}.`
		);
	}
}

export function releaseEnvironment(environment: NodeJS.ProcessEnv = process.env, home = homedir()) {
	const env = { ...environment };
	const path = Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] ?? "";
	for (const key of Object.keys(env)) {
		if (key.toLowerCase() === "path") delete env[key];
	}
	const cargoBin = join(env.CARGO_HOME ?? join(home, ".cargo"), "bin");
	env.PATH = [dirname(process.execPath), path, cargoBin].join(delimiter);
	// Make the build and package assembly agree, including in an independent worktree.
	env.CARGO_TARGET_DIR = resolve(repositoryRoot, env.CARGO_TARGET_DIR ?? "target");
	return env;
}

function runPnpm(args: readonly string[], env: NodeJS.ProcessEnv) {
	const pnpmCli = env.npm_execpath;
	if (!pnpmCli || !existsSync(pnpmCli)) {
		throw new Error("Run the release through pnpm: pnpm release.");
	}
	const isJavaScriptCli = /\.(?:c|m)?js$/i.test(pnpmCli);
	const command = isJavaScriptCli ? process.execPath : pnpmCli;
	const result = spawnSync(command, isJavaScriptCli ? [pnpmCli, ...args] : args, {
		cwd: repositoryRoot,
		env,
		shell: false,
		stdio: "inherit",
		windowsHide: true
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}.`);
	}
}

async function confirmPublication(checkedCommit: string | undefined) {
	if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
		throw new Error(
			"Release publication requires an interactive terminal for confirmation and npm authentication."
		);
	}
	const gate =
		checkedCommit === undefined
			? "All release checks passed."
			: `Skipped pnpm check; operator reports it passed on ${checkedCommit} ` +
				"(release notes may differ).";
	const terminal = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const answer = await terminal.question(
			`\n${gate} Type ${JSON.stringify(publicationConfirmationPhrase(PUBLIC_VERSION))} ` +
				"to begin npm publication and immediate authentication; any other input aborts. "
		);
		assertPublicationConfirmation(answer, PUBLIC_VERSION);
	} finally {
		terminal.close();
	}
}

async function main() {
	const { checkedCommit } = parseReleaseArguments(process.argv.slice(2));
	const env = releaseEnvironment();
	const cargo = spawnSync("cargo", ["--version"], { env, encoding: "utf8", windowsHide: true });
	if (cargo.error || cargo.status !== 0) {
		throw new Error("Release requires Rust. Install it with rustup, then rerun pnpm release.", {
			cause: cargo.error
		});
	}
	await runRelease({
		validateSource: () => assertCleanReleaseSource(),
		check: () => runPnpm(["check"], env),
		confirm: () => confirmPublication(checkedCommit),
		publish: () => runPnpm(["exec", "changeset", "publish"], env),
		reuseCheck:
			checkedCommit === undefined
				? undefined
				: {
						commit: checkedCommit,
						releaseNotes: `docs/releases/${PUBLIC_VERSION}.md`,
						changesSince: changedFilesSince
					}
	});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
