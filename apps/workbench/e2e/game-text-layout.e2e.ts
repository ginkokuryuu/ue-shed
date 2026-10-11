import { test, expect } from "./fixtures/workbench-test.js";

test("Game Text browses indexed translations with the list beside the selected line", async ({
	application,
	workbench
}, testInfo) => {
	test.setTimeout(120_000);
	const page = workbench.page;
	await application.evaluate(({ BrowserWindow }) => {
		BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900);
	});
	await expect
		.poll(() => page.evaluate("({ width: innerWidth, height: innerHeight })"))
		.toEqual({
			width: 1440,
			height: 900
		});
	await workbench.openRoute("Game Text");
	const scan = page.getByRole("button", { name: "Scan project", exact: true });
	await expect(scan).toBeVisible();
	await scan.click();
	const results = page.getByRole("region", { name: "Results" });
	await expect(results.locator("button[data-row]").first()).toBeVisible({ timeout: 60_000 });
	await page.getByRole("button", { name: /^Culture:/u }).click();
	await page
		.getByRole("dialog", { name: "Culture choices" })
		.getByRole("button", { name: "de", exact: true })
		.click();
	await page.getByRole("button", { name: /^Culture:/u }).click();
	await expect(results.getByText("Translation · de", { exact: true })).toBeVisible();
	await expect(page.getByRole("region", { name: "Translation summary" })).toContainText(
		"matching lines"
	);
	await page.getByRole("button", { name: "Display", exact: true }).click();
	await page.getByRole("radio", { name: "Folder", exact: true }).click();
	await page.getByRole("button", { name: "Display", exact: true }).click();
	await page.keyboard.press("Control+k");
	const search = page.getByRole("searchbox", { name: "Search game text" });
	await expect(search).toBeFocused();
	await search.fill("Continue");
	const row = results.locator("button[data-row]").filter({ hasText: "Continue" }).first();
	await expect(row).toBeVisible();
	await row.click();
	const detail = page.getByRole("complementary", { name: "Text focus" });
	await expect(detail.getByRole("heading", { name: "Continue", exact: true })).toBeVisible();
	await expect(row).toBeVisible();
	await detail.getByRole("button", { name: "Next line", exact: true }).click();
	const translatedHeading = detail.getByRole("heading", { name: "<Em>Continue</>", exact: true });
	await expect(translatedHeading).toBeVisible();
	await expect(
		detail.getByRole("article", { name: "Translation de", exact: true })
	).toContainText("<Em>Weiter");
	const listBounds = await results.boundingBox();
	const detailBounds = await detail.boundingBox();
	if (!listBounds || !detailBounds) throw new Error("The list or line detail has no bounds.");
	expect(listBounds.x + listBounds.width).toBeLessThanOrEqual(detailBounds.x + 1);
	expect(detailBounds.width).toBeLessThanOrEqual(401);
	const headerBounds = await page
		.getByRole("heading", { name: "Game Text", level: 1 })
		.boundingBox();
	expect(headerBounds?.y).toBeGreaterThanOrEqual(0);
	await page.screenshot({ path: testInfo.outputPath("game-text-layout-1440.png") });
	await application.evaluate(({ BrowserWindow }) => {
		BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
	});
	await expect
		.poll(() => page.evaluate("({ width: innerWidth, height: innerHeight })"))
		.toEqual({
			width: 1280,
			height: 800
		});
	await expect(row).toBeVisible();
	await expect(translatedHeading).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath("game-text-layout-1280.png") });
	await detail.getByRole("button", { name: "‹ Lines", exact: true }).click();
	await expect(translatedHeading).toHaveCount(0);
	await expect(row).toBeVisible();
	await page.getByRole("button", { name: "Rescan", exact: true }).click();
	await expect(search).toBeEnabled();
	await expect(page.getByRole("button", { name: "Rescan", exact: true })).toBeEnabled();
	await expect(search).toHaveValue("Continue");
	await expect(row).toBeVisible();
	const refreshedHeader = await page
		.getByRole("heading", { name: "Game Text", level: 1 })
		.boundingBox();
	expect(refreshedHeader?.y).toBeGreaterThanOrEqual(0);
});
