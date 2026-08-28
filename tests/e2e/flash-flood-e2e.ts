import assert from "node:assert/strict";

const playwright = process.env.PLAYWRIGHT_PATH ?? "../../../../node_modules/playwright/index.mjs";
const { chromium } = await import(playwright);
const base = process.env.BASE ?? "http://127.0.0.1:5187/project-demo/";
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

const series = {
  time: ["2024-07-01T00:00:00", "2024-07-01T01:00:00", "2024-07-01T02:00:00", "2024-07-01T03:00:00"],
  P: [0, 8, 3, 0],
  Q_obs: [2, 9, 13, 5],
  Q_sim: [2.2, 8.5, 12.4, 5.4],
};
const event = {
  id: "F01", split: "TRAIN", start: series.time[1], end: series.time[3], duration_h: 3,
  peak: 13, peak_sim: 12.4, NSE: 0.88, KGE: 0.82, R2: 0.91, peak_bias: -4.6,
  start_idx: 1, end_idx: 3,
};
const simulation = {
  site: "孤山", model_id: "XAJ", area_km2: 641, params: { WM: 120, B: 0.3 },
  param_source: "calibrated", metrics: { NSE: 0.88, KGE: 0.82, R2: 0.91, Bias: -2.1 },
  events: [event], series, period: { start: series.time[0], end: series.time[3], n: 4 },
};

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.route("**/project-demo/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/project-demo", "");
    const respond = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/health") return respond({ status: "ok" });
    if (path === "/api/model/sites") return respond({ sites: ["孤山", "竹山"] });
    if (path === "/api/model/catalog") return respond({ default: "XAJ", models: [{ id: "XAJ", label: "新安江模型", n_params: 15 }] });
    if (path === "/api/model/flood-rules") return respond({ default: { Q_min: 2, Q_peak: 10, gap_max_days: 2 }, sites: { 孤山: { Q_min: 3, Q_peak: 12, gap_max_days: 1.5 } } });
    if (path === "/api/basins/geojson") return respond({ type: "FeatureCollection", features: [{ type: "Feature", properties: { site: "孤山" }, geometry: { type: "Polygon", coordinates: [[[110.4, 32.2], [110.8, 32.2], [110.8, 32.6], [110.4, 32.2]]] } }] });
    if (path === "/api/basins/ungauged/catalog") return respond({ sites: [{ id: 1, name: "万家湾", site: "ungauged:1", lon: 110.14, lat: 32.18 }], groups: [{ id: "default", name: "无资料" }] });
    if (path.startsWith("/api/model/forcing/")) return respond({ site: "孤山", area_km2: 641, period: { start: "2024-01-01T00:00:00", end: "2024-12-31T23:00:00", n: 8784 } });
    if (path === "/api/model/params") return respond({ params: [{ name: "WM", label: "流域蓄水容量", min: 20, max: 200, value: 120, unit: "mm" }], source: "site", calibration_hint: { has_calibrated: true, maxn: 1000 } });
    if (path === "/api/model/events/divide") { requests.push("events"); return respond(simulation); }
    if (path === "/api/model/simulate") { requests.push("history"); return respond(simulation); }
    if (path === "/api/model/sensitivity") { requests.push("sensitivity"); return respond({ site: "孤山", model_id: "XAJ", metric: "KGE", nstep: 21, params: simulation.params, period: simulation.period, curves: [{ name: "WM", score: 0.91, points: [{ theta: 80, gof: 0.5 }, { theta: 120, gof: 0.82 }, { theta: 160, gof: 0.61 }] }] }); }
    if (path === "/api/model/forecast") { requests.push("forecast"); return respond({ site: "孤山", model_id: "XAJ", area_km2: 641, params: simulation.params, param_source: "calibrated", history: simulation, forecast: { ...simulation, series: { ...series, time: series.time.map((_, index) => `2025-01-01T0${index}:00:00`), Q_obs: [null, null, null, null] } } }); }
    if (path === "/api/model/calibrate/start") { requests.push("calibration"); return respond({ job_id: "job-test-001", status: "queued" }); }
    if (path === "/api/model/calibrate/job-test-001") return respond({ job_id: "job-test-001", site: "孤山", status: "done", maxn: 1000, feval: 1000, best_gof: 0.86, result: simulation });
    return route.continue();
  });

  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.click(".flash-flood-button");
  await page.waitForFunction(() => document.querySelector("[data-service-state]")?.textContent === "实时在线");
  assert.equal(await page.locator("[data-site]").inputValue(), "孤山");
  assert.equal(await page.locator("[data-q-peak]").inputValue(), "12");
  assert.match(await page.locator("[data-data-stats]").textContent(), /641\.0/);
  assert.equal(await page.locator("#layers-section").isVisible(), false);
  const catalog = await page.locator("#ff-sites").textContent() ?? "";
  assert.match(catalog, /国家站/);
  assert.match(catalog, /中小河流站/);
  assert.match(catalog, /无资料站/);
  assert.match(catalog, /孤山/);
  assert.match(catalog, /万家湾/);

  await page.locator("[data-csv-file]").setInputFiles({
    name: "forcing.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("time,P,PET_Romanenko,Q\n2024-01-01T00:00,1,0.2,3\n2024-01-01T01:00,4,0.2,8"),
  });
  await page.waitForFunction(() => document.querySelector("[data-local-badge]")?.textContent === "2 行");
  await page.click("[data-clear-csv]");

  await page.click('[data-tab="events"]');
  await page.click("[data-run-events]");
  await page.waitForSelector("[data-event-chart] svg");
  assert.match(await page.locator("[data-event-table]").textContent(), /F01/);
  if (process.env.FLASH_FLOOD_SCREENSHOT) {
    await page.screenshot({ path: process.env.FLASH_FLOOD_SCREENSHOT, fullPage: true });
  }

  await page.click('[data-tab="history"]');
  await page.click("[data-run-history]");
  await page.waitForSelector("[data-history-chart] svg");
  assert.match(await page.locator("[data-history-metrics]").textContent(), /0\.88/);

  await page.click('[data-tab="sensitivity"]');
  await page.click("[data-run-sensitivity]");
  await page.waitForSelector("[data-sensitivity-chart] svg");
  assert.match(await page.locator("[data-sensitivity-lead]").textContent(), /WM/);

  await page.click('[data-tab="forecast"]');
  await page.click("[data-run-forecast]");
  await page.waitForSelector("[data-forecast-chart] svg");
  assert.match(await page.locator("[data-forecast-strip]").textContent(), /12\.4/);

  await page.click('[data-tab="calibration"]');
  await page.click("[data-run-calibration]");
  await page.waitForFunction(() => document.querySelector("[data-job-value]")?.textContent === "100%");
  assert.match(await page.locator("[data-job-title]").textContent(), /DONE/);

  assert.deepEqual(requests, ["events", "history", "sensitivity", "forecast", "calibration"]);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}

console.log("FLASHFLOOD workflow ok");
