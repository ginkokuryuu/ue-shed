import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noModuleMockingRule } from "./no-module-mocking.ts";
import { noStringifiedCauseInErrorRule } from "./no-stringified-cause-in-error.ts";
import { noForbiddenTermInSymbolNamesRule } from "./no-shape-in-symbol-names.ts";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
	languageOptions: { parserOptions: { lang: "ts" }, sourceType: "module" }
});

ruleTester.run("no-module-mocking", noModuleMockingRule, {
	valid: [
		'import * as vitest from "vitest"; vitest.vi.fn();',
		'import * as helpers from "./helpers"; helpers.vi.mock("./dependency");',
		"const vitest = { vi: { mock() {} } }; vitest.vi.mock();"
	],
	invalid: [
		{
			code: 'import { vi } from "vitest"; vi.mock("./dependency");',
			errors: [{ messageId: "moduleMock" }]
		},
		{
			code: 'import * as vitest from "vitest"; vitest.vi.mock("./dependency");',
			errors: [{ messageId: "moduleMock" }]
		},
		{
			code: 'import * as vitest from "vitest"; vitest["vi"]["doMock"]("./dependency");',
			errors: [{ messageId: "moduleMock" }]
		},
		{
			code: 'import * as globals from "@jest/globals"; globals.jest.unstable_mockModule("./dependency");',
			errors: [{ messageId: "moduleMock" }]
		}
	]
});

ruleTester.run("no-shape-in-symbol-names", noForbiddenTermInSymbolNamesRule, {
	valid: [
		`interface ServiceApi {}
/** @deprecated Use ServiceApi. */
export type ServiceShape = ServiceApi;`
	],
	invalid: [
		{
			code: "type LocalShape = {};",
			errors: [{ messageId: "forbiddenSymbolName" }]
		},
		{
			code: `interface OtherApi {}
/** @deprecated Use OtherApi. */
export type ServiceShape = OtherApi;`,
			errors: [{ messageId: "forbiddenSymbolName" }]
		},
		{
			code: `interface ServiceApi {}
/** @deprecated Use ServiceApi. */
type ServiceShape = ServiceApi;`,
			errors: [{ messageId: "forbiddenSymbolName" }]
		}
	]
});

ruleTester.run("no-stringified-cause-in-error", noStringifiedCauseInErrorRule, {
	valid: [
		'new ReaderError({ message: "The reader failed.", cause });',
		"new ReaderError({ message: `Could not read ${path}.`, cause: error });",
		"report({ message: String(cause) });"
	],
	invalid: [
		{
			code: "new ReaderError({ message: String(cause) });",
			errors: [{ messageId: "stringifiedCause" }]
		},
		{
			code: "new errors.ReaderError({ message: `Read failed: ${String(error)}` });",
			errors: [{ messageId: "stringifiedCause" }]
		},
		{
			code: "new ReaderFailure({ message: Cause.pretty(cause) });",
			errors: [{ messageId: "stringifiedCause" }]
		}
	]
});
