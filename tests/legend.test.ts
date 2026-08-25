import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeHex, parseColorCsv } from "../src/legend";

test("normalizeHex", () => {
  assert.equal(normalizeHex("#abc"), "aabbcc");
  assert.equal(normalizeHex("00ff00"), "00ff00");
});

test("parseColorCsv", () => {
  assert.deepEqual(parseColorCsv("000000,ffffff"), ["000000", "ffffff"]);
  assert.deepEqual(parseColorCsv("#f00, 00ff00"), ["ff0000", "00ff00"]);
  assert.equal(parseColorCsv("viridis"), null);
  assert.equal(parseColorCsv("000000"), null);
  assert.equal(parseColorCsv("xyz,zzz"), null);
});
