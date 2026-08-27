import assert from "node:assert/strict";
import { chromium } from "../../../../node_modules/playwright/index.mjs";

const BASE = "http://127.0.0.1:5187/project-demo/";
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#map .maplibregl-canvas");

  const layout = () =>
    page.evaluate(() => {
      const sidebar = document.querySelector<HTMLElement>("#sidebar")!;
      const shell = document.querySelector<HTMLElement>("#app-shell")!;
      const button = document.querySelector<HTMLButtonElement>("#toggle-sidebar")!;
      const stage = document.querySelector<HTMLElement>(".map-stage")!;
      const canvas = document.querySelector<HTMLCanvasElement>("#map .maplibregl-canvas")!;
      return {
        sidebarHidden: sidebar.hidden,
        shellCollapsed: shell.classList.contains("sidebar-hidden"),
        expanded: button.ariaExpanded,
        label: button.ariaLabel,
        stage: stage.getBoundingClientRect().toJSON(),
        canvas: canvas.getBoundingClientRect().toJSON(),
      };
    });

  const initial = await layout();
  assert.equal(initial.sidebarHidden, false);
  assert.equal(initial.expanded, "true");

  await page.click("#toggle-sidebar");
  await page.waitForFunction(() => document.querySelector<HTMLElement>("#sidebar")?.hidden);
  const closed = await layout();
  assert.equal(closed.shellCollapsed, true);
  assert.equal(closed.expanded, "false");
  assert.equal(closed.label, "打开侧边栏");
  assert.ok(closed.stage.width > initial.stage.width + 250);
  assert.ok(Math.abs(closed.canvas.width - closed.stage.width) < 1);

  await page.click("#toggle-sidebar");
  await page.waitForFunction(() => !document.querySelector<HTMLElement>("#sidebar")?.hidden);
  const reopened = await layout();
  assert.equal(reopened.shellCollapsed, false);
  assert.equal(reopened.expanded, "true");
  assert.equal(reopened.label, "关闭侧边栏");
  assert.ok(Math.abs(reopened.stage.width - initial.stage.width) < 1);
  assert.ok(Math.abs(reopened.canvas.width - reopened.stage.width) < 1);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}

console.log("sidebar toggle ok");
