import assert from "node:assert/strict";
import test from "node:test";
import { GEOMETRY_KIND } from "../src/geometry";
import { formatIdentifyValue, styleIdsFor } from "../src/identify";

test("styleIdsFor maps geojson and geometry layers", () => {
  assert.deepEqual(styleIdsFor({ id: "abc", type: "geojson", metadata: {} }), [
    "layer-abc-fill",
    "layer-abc-line",
    "layer-abc-circle",
  ]);
  assert.deepEqual(
    styleIdsFor({ id: "g1", type: "geojson", metadata: { sourceKind: GEOMETRY_KIND } }),
    ["gee-geom-fill", "gee-geom-line"],
  );
  assert.deepEqual(styleIdsFor({ id: "r1", type: "cog", metadata: {} }), []);
});

test("formatIdentifyValue stringifies primitives and objects", () => {
  assert.equal(formatIdentifyValue(null), "");
  assert.equal(formatIdentifyValue(12.5), "12.5");
  assert.equal(formatIdentifyValue(true), "true");
  assert.equal(formatIdentifyValue("China"), "China");
  assert.equal(formatIdentifyValue({ a: 1 }), '{"a":1}');
});
