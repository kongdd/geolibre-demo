import assert from "node:assert/strict";
import test from "node:test";
import { piWebUrl } from "../plugins/pi-web";

test("Pi Web uses the local server during Vite development", () => {
  assert.equal(piWebUrl("127.0.0.1"), "http://127.0.0.1:30141/");
  assert.equal(piWebUrl("localhost"), "http://127.0.0.1:30141/");
  assert.equal(piWebUrl("ecohydro.top"), "/");
});
