import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "../../../../node_modules/playwright/index.mjs";

const BASE = "http://127.0.0.1:5187/project-demo/";
const OUT = new URL("../../images/e2e", import.meta.url).pathname;

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(String(error)));
mkdirSync(OUT, { recursive: true });

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector("#layers:not(.booting)");
await page.getByText("SRTM", { exact: true }).waitFor({ timeout: 60_000 });
await page.waitForFunction(() => {
  const map = (window as unknown as { __map?: { getStyle?: () => { sources?: Record<string, { tiles?: string[] }> } } })
    .__map;
  const tiles = Object.values(map?.getStyle?.()?.sources ?? {}).flatMap((source) => source.tiles ?? []);
  return tiles.some((tile) => String(tile).includes("earthengine") && !String(tile).includes("pending"));
}, undefined, { timeout: 60_000 });

const readTiles = () => {
  const map = (window as unknown as { __map?: { getStyle?: () => { sources?: Record<string, { tiles?: string[] }> } } })
    .__map;
  return Object.values(map?.getStyle?.()?.sources ?? {})
    .flatMap((source) => source.tiles ?? [])
    .filter((tile) => String(tile).includes("earthengine"));
};

const beforeTiles = await page.evaluate(readTiles);
await page.screenshot({ path: `${OUT}/palette-before.png` });

await page.getByText("SRTM", { exact: true }).dblclick();
await page.waitForSelector(".gee-palette .gee-swatch input");
await page.locator(".gee-swatch input").first().evaluate((el) => {
  const input = el as HTMLInputElement;
  input.value = "#ff0000";
  input.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForFunction(
  (prev) => {
    const map = (window as unknown as { __map?: { getStyle?: () => { sources?: Record<string, { tiles?: string[] }> } } })
      .__map;
    const tiles = Object.values(map?.getStyle?.()?.sources ?? {}).flatMap((source) => source.tiles ?? []);
    return tiles.some((tile) => String(tile).includes("earthengine") && !prev.includes(String(tile)));
  },
  beforeTiles,
  { timeout: 60_000 },
);

const afterTiles = await page.evaluate(readTiles);
await page.screenshot({ path: `${OUT}/palette-after.png` });
await browser.close();

assert.notDeepEqual(afterTiles, beforeTiles);
console.log("before", beforeTiles[0]);
console.log("after", afterTiles[0]);
if (errors.length) console.error(errors);
process.exit(errors.length ? 1 : 0);
