import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "../../../../node_modules/playwright/index.mjs";

const browser = await chromium.launch({
  headless: false,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--enable-webgl",
    "--enable-webgl2",
    "--ignore-gpu-blocklist",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors: string[] = [];
let downloads = 0;
page.on("pageerror", (error) => errors.push(String(error)));
page.on("download", () => downloads += 1);

await page.route("**/api/watershed", (route) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      pour_points_geojson: JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [111, 32] },
            properties: { id: 1 },
          },
        ],
      }),
      watershed_geojson: JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [[[110, 31], [112, 31], [112, 33], [110, 31]]],
            },
            properties: { VALUE: 1 },
          },
        ],
      }),
      basin_stats: [
        {
          id: 1,
          pixels: 1,
          centroid_lon: 111,
          centroid_lat: 32,
          bbox: { row_min: 0, row_max: 0, col_min: 0, col_max: 0 },
          area_km2: 12.3,
        },
      ],
      walls_ms: 25,
    }),
  }),
);

await page.goto(process.env.PROJECT_DEMO_URL ?? "http://127.0.0.1:5187/project-demo/", {
  waitUntil: "domcontentloaded",
});
await page.waitForFunction(() => typeof window.__geometryDump === "function");
await page.click('button[data-tip="流域快速提取"]');
await page.waitForFunction(() =>
  [...document.querySelector<HTMLSelectElement>("[data-flowdir]")!.options].some(
    ({ text }) => text === "湖北流向",
  ),
);

const optionNames = await page.evaluate(() => ({
  flowdir: [...document.querySelector<HTMLSelectElement>("[data-flowdir]")!.options].map(
    ({ text }) => text,
  ),
  flowaccu: [...document.querySelector<HTMLSelectElement>("[data-flowaccu]")!.options].map(
    ({ text }) => text,
  ),
}));
assert(optionNames.flowdir.includes("湖北流向"));
assert(optionNames.flowaccu.includes("湖北累积流"));

await page.click("[data-pick]");
const interactions = await page.evaluate(() => ({
  scroll: window.__map!.scrollZoom.isEnabled(),
  pan: window.__map!.dragPan.isEnabled(),
  doubleClick: window.__map!.doubleClickZoom.isEnabled(),
}));
assert.deepEqual(interactions, { scroll: true, pan: true, doubleClick: true });

const canvas = page.locator("#map .maplibregl-canvas");
const bounds = (await canvas.boundingBox())!;
const before = await page.evaluate(() => window.__map!.getZoom());
await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
await page.mouse.wheel(0, -500);
await page.waitForTimeout(600);
assert((await page.evaluate(() => window.__map!.getZoom())) > before);
await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
await page.click("[data-run]");
await page.waitForFunction(() => document.querySelector("#status")?.textContent?.includes("流域提取完成"));
assert.equal(downloads, 0);

const tree = (await page.locator("#layers").textContent()) ?? "";
for (const text of ["Pours", "Basins", "Pour_出水口 1", "流域 1"]) {
  assert(tree.includes(text), `缺少 ${text}:\n${tree}`);
}
await page.click("#save-project");
await page.waitForFunction(() => document.querySelector("#status")?.textContent === "Project 已保存到 Remote");
const key = await page.evaluate(() => localStorage.getItem("geolibre:last-remote-project"));
assert(key);
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.click("#export-project"),
]);
assert.equal(download.suggestedFilename(), `${key}.geolibre.json`);
const saved = JSON.parse(readFileSync((await download.path())!, "utf8"));
for (const layer of saved.layers.filter((value: { metadata?: { watershedRole?: string } }) =>
  value.metadata?.watershedRole,
)) {
  assert.equal(layer.geojson, undefined);
  assert.match(layer.source.url, new RegExp(`/projects/${key}/data/.+\\.geojson$`));
}
await page.evaluate((projectKey) =>
  fetch(`/project-demo/api/projects/${encodeURIComponent(projectKey)}`, { method: "DELETE" }), key);
assert.equal(errors.length, 0, errors.join("\n"));
await browser.close();
