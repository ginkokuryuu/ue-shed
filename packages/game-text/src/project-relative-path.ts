import { relative, resolve, sep } from "node:path";

/** A forward-slash relative path whose segments resolution cannot change: no root, drive, colon,
 * backslash, empty, `.` or `..` segment. Resolving it under a root and taking it relative again
 * only swaps the separator, so callers can skip the two path-module calls.
 */
export function plainRelativePath(path: string): boolean {
	if (path === "" || path.includes(":") || path.includes("\\")) return false;
	for (const segment of path.split("/"))
		if (segment === "" || segment === "." || segment === "..") return false;
	return true;
}

/** Same value as `relative(root, resolve(root, path))`, without path-module work for plain paths. */
export function projectRelativePath(root: string, path: string, separator = sep): string {
	if (plainRelativePath(path)) return separator === "/" ? path : path.replaceAll("/", separator);
	return relative(root, resolve(root, path));
}
