import { GameTextClientError } from "./game-text-client.js";

/**
 * A failed request said in plain words: what could not happen and how to recover. Client errors
 * carry their own recovery; anything else is unexpected, so it only offers a retry.
 */
export function failureText(what: string, cause: unknown): string {
	const recovery =
		cause instanceof GameTextClientError
			? cause.recovery
			: "Try again. If it keeps failing, restart Workbench.";
	return `${what} ${recovery}`;
}
