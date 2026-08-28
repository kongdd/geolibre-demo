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
  await page.waitForFunction(() => document.querySelector("[data-service-state]")?.textContent === "实时在线", null, { timeout: 60_000 });

  assert.equal(await page.locator("[data-site] option").count(), 24);
  assert.equal(await page.locator("[data-model] option").count(), 6);
  await page.selectOption("[data-site]", { label: "孤山" });
  await page.waitForFunction(() => /322\.0/.test(document.querySelector("[data-data-stats]")?.textContent ?? ""));
  await page.fill("[data-start]", "2016-07-01T00:00");
  await page.fill("[data-end]", "2016-08-01T00:00");

  await page.click('[data-tab="events"]');
  await page.click("[data-run-events]");
  await page.waitForSelector("[data-event-chart] svg", { timeout: 120_000 });
  assert.ok(await page.locator("[data-event-table] tr").count() >= 1);
  await page.screenshot({ path: "images/flash-flood-workspace.png", fullPage: true });

  await page.click('[data-tab="history"]');
  await page.click("[data-run-history]");
  await page.waitForSelector("[data-history-chart] svg", { timeout: 120_000 });
  assert.match(await page.locator("[data-history-metrics]").textContent(), /NSE.*KGE/s);

  await page.click('[data-tab="sensitivity"]');
  await page.fill("[data-nstep]", "5");
  await page.click("[data-run-sensitivity]");
  await page.waitForSelector("[data-sensitivity-chart] svg", { timeout: 120_000 });
  assert.ok((await page.locator("[data-sensitivity-ranks] article").count()) >= 1);

  await page.click('[data-tab="forecast"]');
  await page.fill("[data-history-end]", "2016-07-01T00:00");
  await page.fill("[data-forecast-start]", "2016-07-01T01:00");
  await page.fill("[data-forecast-end]", "2016-07-08T00:00");
  await page.click("[data-run-forecast]");
  await page.waitForSelector("[data-forecast-chart] svg", { timeout: 120_000 });
  assert.match(await page.locator("[data-forecast-strip]").textContent(), /预报洪峰.*峰现时间/s);

  await page.click('[data-tab="calibration"]');
  await page.fill("[data-maxn]", "100");
  await page.click("[data-run-calibration]");
  await page.waitForFunction(() => /QUEUED|RUNNING|DONE/.test(document.querySelector("[data-job-title]")?.textContent ?? ""), null, { timeout: 120_000 });
  const cancel = page.locator("[data-cancel-calibration]");
  if (await cancel.isEnabled()) await cancel.click();

  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}

console.log("FLASHFLOOD real SpatialHydro workflow ok");
