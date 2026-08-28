import assert from "node:assert/strict";

const playwright = process.env.PLAYWRIGHT_PATH ?? "../../../../node_modules/playwright/index.mjs";
const { chromium } = await import(playwright);
const base = process.env.BASE ?? "http://127.0.0.1:5187/project-demo/";
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.route("http://127.0.0.1:30141/", (route) => route.fulfill({ body: "Pi Web" }));
  await page.goto(base, { waitUntil: "domcontentloaded" });
  const before = await page.locator(".map-stage").evaluate((element) => element.getBoundingClientRect().width);
  await page.click("#toggle-pi-web");
  await page.waitForSelector("#pi-web:not([hidden])");
  assert.equal(await page.locator("#pi-web-frame").getAttribute("src"), "http://127.0.0.1:30141/");
  assert.ok(await page.locator(".map-stage").evaluate((element) => element.getBoundingClientRect().width) < before - 300);
  await page.click("#pi-web-close");
  assert.equal(await page.locator("#pi-web").isHidden(), true);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}

console.log("Pi Web panel ok");
