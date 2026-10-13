import { test, expect } from "./fixtures/workbench-test.js";

type Box = { x: number; y: number; width: number; height: number } | null;

/** Layout is compared to half a pixel: subpixel positions differ across DPI scales. */
function expectSameBox(actual: Box, expected: Box) {
	if (!actual || !expected) throw new Error("A compared element has no bounds.");
	for (const side of ["x", "y", "width", "height"] as const)
		expect(Math.abs(actual[side] - expected[side])).toBeLessThanOrEqual(0.5);
}

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
	const measuredProgress = page.getByRole("progressbar");
	await expect(measuredProgress).toBeVisible({ timeout: 60_000 });
	await expect
		.poll(async () => Number(await measuredProgress.getAttribute("aria-valuenow")))
		.toBeGreaterThan(0);
	await page.screenshot({ path: testInfo.outputPath("game-text-scan-measured-1440.png") });
	await page
		.getByRole("heading", { name: "Game Text", level: 1 })
		.locator("..")
		.screenshot({ path: testInfo.outputPath("game-text-scan-measured-header-1440.png") });
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
		"Outside this target"
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
		const context = page.getByRole("group", { name: "Translations", exact: true });
		const before = {
			header: await header.boundingBox(),
			status: await status.boundingBox(),
			context: await context.boundingBox(),
			results: await results.boundingBox()
		};
		if (!before.header || !before.context) throw new Error("The header has no bounds.");
		// The title row stays one row, with the translation controls directly beneath it.
		expect(before.header.height).toBeLessThanOrEqual(41);
		expect(Math.abs(before.context.y - (before.header.y + before.header.height))).toBeLessThan(
			1
		);
		await page.getByRole("button", { name: "Rescan", exact: true }).click();
		const activity = status.locator('[data-scan-activity="true"]');
		// A rescan of unchanged inputs can finish before a frame is observed, so the in-flight
		// checks run only while the activity is showing; the before/after layout always runs.
		const caught = await activity
			.waitFor({ state: "visible", timeout: 2_000 })
			.then(() => true)
			.catch(() => false);
		if (caught) {
			await expect(page.getByRole("progressbar")).toBeHidden();
			expectSameBox(await header.boundingBox(), before.header);
			expectSameBox(await status.boundingBox(), before.status);
			expectSameBox(await context.boundingBox(), before.context);
			expectSameBox(await results.boundingBox(), before.results);
			const progressBounds = await activity.boundingBox();
			if (progressBounds && before.status) {
				expect(progressBounds.width).toBeLessThanOrEqual(16);
				expect(progressBounds.y).toBeGreaterThanOrEqual(before.header.y);
				expect(progressBounds.y + progressBounds.height).toBeLessThanOrEqual(
					before.header.y + before.header.height
				);
			}
			await page.screenshot({ path: testInfo.outputPath(`game-text-rescan-${width}.png`) });
			await header.screenshot({
				path: testInfo.outputPath(`game-text-rescan-header-${width}.png`)
			});
		}
		await expect(activity).toBeHidden();
		await expect(page.getByRole("button", { name: "Rescan", exact: true })).toBeEnabled();
		expectSameBox(await header.boundingBox(), before.header);
		expectSameBox(await status.boundingBox(), before.status);
		expectSameBox(await results.boundingBox(), before.results);
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
	// At 1024 px the title row still holds the views, scan state and Rescan on one line, and the
	// translation controls keep theirs.
	const titleRow = await page
		.getByRole("heading", { name: "Game Text", level: 1 })
		.locator("..")
		.boundingBox();
	const rescanBounds = await page
		.getByRole("button", { name: "Rescan", exact: true })
		.boundingBox();
	const reportsBounds = await page.getByRole("tab", { name: "Reports" }).boundingBox();
	const contextBounds = await page
		.getByRole("group", { name: "Translations", exact: true })
		.boundingBox();
	if (!titleRow || !rescanBounds || !reportsBounds || !contextBounds)
		throw new Error("The header has no bounds.");
	expect(titleRow.height).toBeLessThanOrEqual(41);
	expect(rescanBounds.x).toBeGreaterThan(reportsBounds.x + reportsBounds.width);
	expect(contextBounds.height).toBeLessThanOrEqual(37);
	// A footer inside the route's main landmark has no role, so it is found through its summary.
	const footer = page.getByRole("region", { name: "Translation summary" }).locator("..");
	expect((await footer.boundingBox())?.height).toBeLessThanOrEqual(27);
	expect(await footer.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
		true
	);
	const displayBounds = await page
		.getByRole("button", { name: "Display", exact: true })
		.boundingBox();
	const filterBounds = await page
		.getByRole("button", { name: "Filter", exact: true })
		.boundingBox();
	expect(Math.abs((displayBounds?.y ?? 0) - (filterBounds?.y ?? -1))).toBeLessThanOrEqual(0.5);

	expect(
		await results.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
	).toBe(true);
	const back = detail.getByRole("button", { name: "‹ Lines", exact: true });
	const beforeScroll = await back.boundingBox();
	// The sticky header is only proven when the page actually scrolls.
	expect(await detail.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
		true
	);
	await detail.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	expectSameBox(await back.boundingBox(), beforeScroll);
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

	const sidePane = page.getByRole("button", { name: "Side pane", exact: true });
	await expect(sidePane).toHaveAttribute("aria-pressed", "true");
	await sidePane.click();
	await expect(sidePane).toHaveAttribute("aria-pressed", "false");
	await expect(sidePane).toBeFocused();
	await expect(translatedHeading).toHaveCount(0);
	await expect(detail).toBeHidden();
	await sidePane.click();
	await expect(detail).toBeVisible();
	await expect(row).toBeVisible();
	// Going back to the list returns focus to the line's row.
	await row.click();
	await expect(detail.getByRole("heading", { name: "Continue", exact: true })).toBeVisible();
	await detail.getByRole("button", { name: "‹ Lines", exact: true }).click();
	await expect(row).toBeFocused();
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
