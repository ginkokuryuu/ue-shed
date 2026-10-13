import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");

export interface ReleaseSourceState {
	readonly changes: string;
	readonly head: string;
}

export function validateCleanReleaseSource(
	{ changes, head }: ReleaseSourceState,
	expectedCommit?: string
) {
	if (expectedCommit !== undefined && head !== expectedCommit) {
		throw new Error(
			`Release commit ${expectedCommit} does not match checked-out HEAD ${head}.`
		);
	}
	if (changes.trim() !== "") {
		throw new Error("Release artifact generation requires a clean worktree.");
	}
	return head;
}

function git(args: readonly string[]) {
	const result = spawnSync("git", args, {
		cwd: repositoryRoot,
		encoding: "utf8",
		shell: false
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			`git ${args.join(" ")} failed:\n${result.stdout ?? ""}\n${result.stderr ?? ""}`
		);
	}
	return result.stdout.trim();
}

/** Repository-relative files changed from an ancestor commit to HEAD. */
export function changedFilesSince(commit: string) {
	const ancestry = spawnSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], {
		cwd: repositoryRoot,
		shell: false
	});
	if (ancestry.error) throw ancestry.error;
	if (ancestry.status !== 0) {
		throw new Error(`Commit ${commit} is not an ancestor of the release HEAD.`);
	}
	const changes = git(["diff", "--name-only", "--no-renames", commit, "HEAD"]);
	return changes === "" ? [] : changes.split("\n");
}

export function assertCleanReleaseSource(expectedCommit?: string) {
	return validateCleanReleaseSource(
		{
			changes: git(["status", "--porcelain", "--untracked-files=all"]),
			head: git(["rev-parse", "HEAD"])
		},
		expectedCommit
	);
}
