import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown } from "../plugins/pi-agent/markdown";
import { normalizeMessages, normalizePromptImages, piAgentRoute } from "../plugins/pi-agent/plugin";

test("Pi Agent route accepts base-prefixed API only", () => {
  assert.equal(piAgentRoute("/project-demo/api/pi-agent"), true);
  assert.equal(piAgentRoute("/api/pi-agent/"), true);
  assert.equal(piAgentRoute("/api/pi-agent/messages"), false);
});

test("Pi accepts one bounded UI screenshot", () => {
  const image = { type: "image", data: "aGVsbG8=", mimeType: "image/jpeg" };
  assert.deepEqual(normalizePromptImages([image]), [image]);
  assert.throws(() => normalizePromptImages([image, image]), /最多共享一张/);
  assert.throws(() => normalizePromptImages([{ ...image, mimeType: "image/svg+xml" }]), /不支持/);
});

test("Pi history keeps user and assistant text", () => {
  assert.deepEqual(
    normalizeMessages([
      { role: "user", content: "Hello", timestamp: 1 },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Check" },
          { type: "text", text: "World" },
        ],
      },
      { role: "toolResult", content: "secret" },
    ]),
    [
      { role: "user", content: "Hello", timestamp: 1 },
      { role: "assistant", content: "World", thinking: "Check" },
    ],
  );
});

test("Markdown renders common blocks without allowing raw HTML or unsafe links", () => {
  const html = renderMarkdown(`## Title\n\n- **safe**\n- [bad](javascript:alert(1))\n\n\`\`\`ts\n<script>\n\`\`\`\n\n| A | B |\n| --- | --- |\n| 1 | 2 |`);
  assert.match(html, /<h2>Title<\/h2>/);
  assert.match(html, /<ul><li><strong>safe<\/strong><\/li>/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<table>/);
});
