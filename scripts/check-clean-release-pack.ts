import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Proves that `release:pack` succeeds from a clean checkout with no prior build: packs the
 * committed HEAD in a temporary git worktree, where no package `dist` output exists yet.
 */
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(command: string, args: readonly string[], cwd: string, env = process.env) {
	const isWindows = process.platform === "win32";
	const result = spawnSync(
		isWindows ? (process.env.ComSpec ?? "cmd.exe") : command,
		isWindows ? ["/d", "/s", "/c", command, ...args] : args,
		{ cwd, env, stdio: "inherit" }
	);
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed in ${cwd}`);
}

const parent = await mkdtemp(join(tmpdir(), "ue-shed-clean-pack-"));
const worktree = join(parent, "checkout");
run("git", ["worktree", "add", "--detach", worktree, "HEAD"], repositoryRoot);
try {
	run("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], worktree);
	// Reuse the native build cache; the check is about TypeScript build order, not Rust.
	const env = {
		...process.env,
		CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR ?? join(repositoryRoot, "target")
	};
	run("pnpm", ["run", "release:pack"], worktree, env);
	console.log("release:pack succeeded from a clean checkout of HEAD.");
} finally {
	// Node removes deep node_modules paths that `git worktree remove` cannot on Windows.
	await rm(parent, { recursive: true, force: true, maxRetries: 3 });
	run("git", ["worktree", "prune"], repositoryRoot);
}
