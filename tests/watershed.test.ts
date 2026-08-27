import assert from "node:assert/strict";
import test from "node:test";
import { formatElapsed, outletsToGeoJSON, parsePourPoints } from "../plugins/watershed";

test("formatElapsed uses readable units", () => {
  assert.equal(formatElapsed(35), "35 ms");
  assert.equal(formatElapsed(1234), "1.23 s");
});

test("parsePourPoints names coordinates and accepts explicit names", () => {
  assert.deepEqual(parsePourPoints("110.8, 32.6\n丹江口, 110.9, 32.7\n7, 十堰, 111, 33"), [
    { id: 1, name: "出水口 1", lon: 110.8, lat: 32.6 },
    { id: 2, name: "丹江口", lon: 110.9, lat: 32.7 },
    { id: 7, name: "十堰", lon: 111, lat: 33 },
  ]);
  assert.throws(() => parsePourPoints("甲, 110, 32\n甲, 111, 33"), /名称不能重复/);
});

test("outletsToGeoJSON preserves named user assets", () => {
  assert.deepEqual(outletsToGeoJSON([{ id: 3, name: "丹江口", lon: 111, lat: 32 }]), {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [111, 32] },
        properties: { id: 3, name: "丹江口" },
      },
    ],
  });
});
