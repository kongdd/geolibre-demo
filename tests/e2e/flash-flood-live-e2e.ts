import assert from "node:assert/strict";

const playwright = process.env.PLAYWRIGHT_PATH ?? "../../../../node_modules/playwright/index.mjs";
const { chromium } = await import(playwright);
const base = process.env.BASE ?? "http://127.0.0.1:5187/project-demo/";
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.click(".flash-flood-button");
  await page.waitForFunction(() => document.querySelector("[data-service-state]")?.textContent === "实时在线", undefined, { timeout: 60_000 });

  assert.equal(await page.locator("[data-site] option").count(), 24);
  assert.equal(await page.locator("[data-model] option").count(), 6);
  assert.equal(await page.locator("[data-params] label").count(), 15);
  assert.match(await page.locator("[data-data-stats]").textContent(), /322\.0/);
  assert.equal(await page.locator("[data-end]").inputValue(), "2023-12-31T22:00");

  await page.fill("[data-start]", "2023-06-01T00:00");
  await page.fill("[data-end]", "2023-09-01T00:00");
  await page.click('[data-tab="history"]');
  await page.click("[data-run-history]");
  await page.waitForSelector("[data-history-chart] svg", { timeout: 120_000 });
  assert.match(await page.locator("[data-history-table]").textContent(), /F\d+/);

  if (process.env.FLASH_FLOOD_SCREENSHOT) {
    await page.screenshot({ path: process.env.FLASH_FLOOD_SCREENSHOT, fullPage: true });
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}

console.log("FLASHFLOOD live SpatialHydro integration ok");
