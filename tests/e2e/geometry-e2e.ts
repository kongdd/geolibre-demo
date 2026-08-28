import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
const playwright = process.env.PLAYWRIGHT_PATH ?? "../../../../node_modules/playwright/index.mjs";
const { chromium } = await import(playwright);

const BASE = "http://127.0.0.1:5187/project-demo/";
const OUT = new URL("../../images/e2e", import.meta.url).pathname;

type Dump = {
  mode: string;
  draft: number;
  open: boolean;
  layers: { name: string; types: string[] }[];
  top?: string[];
};

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
page.on("pageerror", (error) => errors.push(String(error)));

mkdirSync(OUT, { recursive: true });

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector("#layers:not(.booting)");
await page.waitForSelector(".maplibregl-canvas");
await page.waitForFunction(() => typeof window.__geometryDump === "function");

await page.click("#draw-geometry");
await page.waitForSelector(".geom-bar:not([hidden])");

const canvas = page.locator("#map .maplibregl-canvas");
async function tap(x: number, y: number): Promise<void> {
  await canvas.click({ position: { x, y } });
  await page.waitForTimeout(80);
}

async function dump(): Promise<Dump> {
  return page.evaluate(() => window.__geometryDump!());
}

await page.click('.geom-tools button[data-mode="point"]');
assert.equal((await dump()).mode, "point");
await tap(300, 180);
await tap(340, 240);
await page.screenshot({ path: `${OUT}/point.png` });
const afterPoint = await dump();
assert.ok(
  afterPoint.layers.flatMap((layer) => layer.types).includes("Point"),
  `point should commit Point, got ${JSON.stringify(afterPoint)}`,
);

await page.hover(".geom-imports");
await page.click("#geom-new");
await page.click('.geom-tools button[data-mode="line"]');
assert.equal((await dump()).mode, "line", "line tool should activate");
await tap(360, 220);
await tap(520, 260);
await tap(480, 380);
await page.keyboard.press("Enter");
await page.screenshot({ path: `${OUT}/line.png` });
const afterLine = await dump();
const lineLayer = afterLine.layers.find((layer) => layer.types.includes("LineString"));
assert.deepEqual(lineLayer?.types, ["LineString"], `line should commit LineString, got ${JSON.stringify(afterLine)}`);
assert.ok(afterLine.top?.includes("gee-geom-line"), `line layer must be on top, got ${afterLine.top}`);

await page.hover(".geom-imports");
await page.click("#geom-new");
await page.click('.geom-tools button[data-mode="polygon"]');
assert.equal((await dump()).mode, "polygon");
await tap(280, 200);
await tap(430, 200);
await tap(400, 330);
await page.keyboard.press("Enter");
await page.screenshot({ path: `${OUT}/polygon.png` });
const afterPoly = await dump();
const polyTypes = afterPoly.layers.flatMap((layer) => layer.types);
assert.ok(polyTypes.includes("Polygon"), `polygon should commit Polygon, got ${JSON.stringify(afterPoly)}`);

await page.hover(".geom-imports");
await page.click("#geom-new");
await page.click('.geom-tools button[data-mode="rectangle"]');
const box = await canvas.boundingBox();
assert.ok(box);
await page.mouse.move(box.x + 300, box.y + 180);
await page.mouse.down();
await page.mouse.move(box.x + 460, box.y + 320, { steps: 8 });
await page.mouse.up();
await page.screenshot({ path: `${OUT}/rectangle.png` });
const afterRect = await dump();
const polygonLayers = afterRect.layers.filter((layer) => layer.types.includes("Polygon"));
assert.equal(polygonLayers.length, 2, `rectangle should commit Polygon, got ${JSON.stringify(afterRect)}`);

await page.screenshot({ path: `${OUT}/point-line-poly.png` });
assert.equal(errors.length, 0, errors.join("\n"));
await browser.close();
console.log("ok", afterRect);
