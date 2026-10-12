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
	expect((await search.boundingBox())?.width).toBeGreaterThanOrEqual(150);
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
	const checkRescanLayout = async (width: number) => {
		const header = page.getByRole("heading", { name: "Game Text", level: 1 }).locator("..");
		const status = page.locator('[aria-label="Index status"]');
		const summary = page.getByRole("region", { name: "Translation summary" });
		const before = {
			header: await header.boundingBox(),
			status: await status.boundingBox(),
			summary: await summary.boundingBox(),
			results: await results.boundingBox()
		};
		if (!before.header || !before.summary) throw new Error("The header has no bounds.");
		expect(before.summary.y).toBe(before.header.y + before.header.height);
		await page.getByRole("button", { name: "Rescan", exact: true }).click();
		const progress = page.getByRole("progressbar");
		await expect(progress).toBeVisible();
		await expect(status).toContainText("elapsed");
		expect(await header.boundingBox()).toEqual(before.header);
		expect(await status.boundingBox()).toEqual(before.status);
		expect(await results.boundingBox()).toEqual(before.results);
		const progressBounds = await progress.boundingBox();
		if (!progressBounds) throw new Error("Scan progress has no bounds.");
		expect(progressBounds.y).toBeGreaterThanOrEqual(before.header.y);
		expect(progressBounds.y + progressBounds.height).toBeLessThanOrEqual(
			before.header.y + before.header.height
		);
		await page.screenshot({ path: testInfo.outputPath(`game-text-rescan-${width}.png`) });
		await expect(progress).toBeHidden();
		await expect(page.getByRole("button", { name: "Rescan", exact: true })).toBeEnabled();
		expect(await header.boundingBox()).toEqual(before.header);
		expect(await status.boundingBox()).toEqual(before.status);
		expect(await results.boundingBox()).toEqual(before.results);
		await expect(row).toBeVisible();
	};
	const headerBounds = await page
		.getByRole("heading", { name: "Game Text", level: 1 })
		.boundingBox();
	expect(headerBounds?.y).toBeGreaterThanOrEqual(0);
	await checkRescanLayout(1440);
	await page.screenshot({ path: testInfo.outputPath("game-text-layout-1440.png") });
	const reviewTool = detail
		.getByRole("article", { name: "Translation de", exact: true })
		.getByRole("button", { name: "Reviewed", exact: true });
	await reviewTool.focus();
	const tooltip = page.getByRole("tooltip");
	await expect(tooltip).toContainText("Checked against the source text.");
	const tooltipId = await tooltip.getAttribute("id");
	if (!tooltipId) throw new Error("The review tooltip has no accessible ID.");
	await expect(reviewTool).toHaveAttribute("aria-describedby", tooltipId);
	await page.screenshot({ path: testInfo.outputPath("game-text-tools-tooltip.png") });
	await page.keyboard.press("Escape");
	await expect(tooltip).toBeHidden();
	await expect(reviewTool).toBeFocused();
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
	await checkRescanLayout(1280);
	await page.screenshot({ path: testInfo.outputPath("game-text-layout-1280.png") });
	await application.evaluate(({ BrowserWindow }) => {
		BrowserWindow.getAllWindows()[0]?.setContentSize(1024, 768);
	});
	await expect.poll(() => page.evaluate("innerWidth")).toBe(1024);
	expect((await search.boundingBox())?.width).toBeGreaterThanOrEqual(150);
	const rescanBounds = await page
		.getByRole("button", { name: "Rescan", exact: true })
		.boundingBox();
	const cultureBounds = await page.getByRole("button", { name: /^Culture:/u }).boundingBox();
	if (!rescanBounds || !cultureBounds) throw new Error("The header tools have no bounds.");
	expect(rescanBounds.y + rescanBounds.height / 2).toBe(
		cultureBounds.y + cultureBounds.height / 2
	);
	expect(
		(await page.getByRole("button", { name: "Display", exact: true }).boundingBox())?.y
	).toBe((await page.getByRole("button", { name: "Filter", exact: true }).boundingBox())?.y);

	expect(
		await results.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
	).toBe(true);
	const back = detail.getByRole("button", { name: "‹ Lines", exact: true });
	const beforeScroll = await back.boundingBox();
	await detail.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	expect((await back.boundingBox())?.y).toBe(beforeScroll?.y);
	await checkRescanLayout(1024);
	await page.screenshot({ path: testInfo.outputPath("game-text-layout-1024.png") });
	await page.getByRole("button", { name: "Filter", exact: true }).click();
	await page.getByRole("menuitem", { name: /^Folder/u }).click();
	const submenu = page.getByRole("menu", { name: "Folder", exact: true });
	const submenuBounds = await submenu.boundingBox();
	if (!submenuBounds) throw new Error("The filter submenu has no bounds.");
	expect(submenuBounds.x).toBeGreaterThanOrEqual(0);
	expect(submenuBounds.y).toBeGreaterThanOrEqual(0);
	expect(submenuBounds.x + submenuBounds.width).toBeLessThanOrEqual(1024);
	expect(submenuBounds.y + submenuBounds.height).toBeLessThanOrEqual(768);
	await page.keyboard.press("Escape");
	await page.keyboard.press("Escape");

	await page.getByRole("button", { name: "Hide side pane", exact: true }).click();
	await expect(translatedHeading).toHaveCount(0);
	await expect(detail).toBeHidden();
	await page.getByRole("button", { name: "Show side pane", exact: true }).click();
	await expect(detail).toBeVisible();
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
