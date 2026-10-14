import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Keep isolated workers from starving process and native-reader integration tests.
		maxWorkers: 4,
		coverage: {
			exclude: [
				"**/*.d.ts",
				"**/*.test.{ts,tsx}",
				"**/*.test-support.{ts,tsx}",
				"**/*.integration.test.{ts,tsx}",
				"**/*.e2e.{ts,tsx}"
			],
			include: [
				"apps/*/src/**/*.{ts,tsx}",
				"extensions/*/src/**/*.{ts,tsx}",
				"packages/*/src/**/*.{ts,tsx}"
			],
			provider: "v8",
			reporter: [["text", { skipFull: true }], "html", "json-summary"],
			reportsDirectory: "coverage"
		},
		projects: ["./vitest.node.config.ts", "./vitest.component.config.ts"]
	}
});
