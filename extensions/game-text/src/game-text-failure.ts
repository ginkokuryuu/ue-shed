import { Cause, Schema } from "effect";
import { GameTextClientError } from "./game-text-client.js";

const isGameTextClientError = Schema.is(GameTextClientError);

/**
 * A failed request said in plain words: what could not happen and how to recover. Client errors
 * carry their own recovery; anything else is unexpected, so it only offers a retry.
 */
export function failureText(what: string, cause: unknown): string {
	if (isGameTextClientError(cause)) return `${what} ${cause.recovery}`;
	if (Cause.isCause(cause)) {
		for (const reason of cause.reasons) {
			if (Cause.isFailReason(reason) && isGameTextClientError(reason.error))
				return `${what} ${reason.error.recovery}`;
		}
	}
	return `${what} Try again. If it keeps failing, restart Workbench.`;
}
