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
  const actions: string[] = [];
  let promptHasImage = false;
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        canvas.getContext("2d")!.fillRect(0, 0, 320, 180);
        return canvas.captureStream(1);
      },
    });
  });
  await page.route("**/api/pi-agent", async (route) => {
    const body = route.request().postDataJSON() as { action: string; images?: unknown[] };
    actions.push(body.action);
    if (body.action === "prompt") {
      promptHasImage = body.images?.length === 1;
      return route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: '{"type":"delta","delta":"# Reply\\n\\n- item"}\n{"type":"done"}\n',
      });
    }
    if (body.action === "state" || body.action === "model") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session: "chat-test.jsonl",
          model: { provider: "test", id: "gpt", name: "GPT", reasoning: true, thinkingLevelMap: { xhigh: "xhigh" } },
          thinkingLevel: "high",
          models: [{ provider: "test", id: "gpt", name: "GPT", reasoning: true, thinkingLevelMap: { xhigh: "xhigh" } }],
          messages: [],
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{\"ok\":true}" });
  });

  await page.goto(base, { waitUntil: "domcontentloaded" });
  const initialWidth = await page.locator(".map-stage").evaluate((element) => element.getBoundingClientRect().width);
  await page.click("#toggle-pi-chat");
  await page.waitForSelector("#pi-chat:not([hidden])");
  await page.waitForFunction(() => (document.querySelector<HTMLSelectElement>("#pi-chat-model")?.value ?? "") === "test/gpt");
  const openWidth = await page.locator(".map-stage").evaluate((element) => element.getBoundingClientRect().width);
  assert.ok(openWidth < initialWidth - 350);
  assert.equal(await page.locator("#pi-chat-thinking").inputValue(), "high");
  await page.click("#pi-chat-share");
  await page.waitForFunction(() => document.querySelector("#pi-chat-share")?.getAttribute("aria-pressed") === "true");

  await page.fill("#pi-chat-input", "**Hello**");
  await page.press("#pi-chat-input", "Enter");
  await page.waitForSelector(".pi-message.assistant h1");
  assert.equal(await page.locator(".pi-message.user strong").textContent(), "Hello");
  assert.equal(await page.locator(".pi-message.assistant li").textContent(), "item");
  assert.ok(actions.includes("state") && actions.includes("prompt"));
  assert.equal(promptHasImage, true);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}

console.log("Pi Agent panel ok");
