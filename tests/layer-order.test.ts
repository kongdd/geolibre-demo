import assert from "node:assert/strict";
import test from "node:test";
import {
  basemapInsertIndex,
  basemapNativeIds,
  dropInsertIndex,
  occludedBasemapIds,
} from "../src/layer-order";

const layer = (id: string, kind?: string) => ({
  id,
  metadata: kind ? { sourceKind: kind } : {},
});

test("new basemap sits in front of existing basemaps", () => {
  assert.equal(basemapInsertIndex([layer("bm1", "maplibre-basemap-control"), layer("data"), layer("new", "maplibre-basemap-control")], "new"), 1);
  assert.equal(basemapInsertIndex([layer("data"), layer("new", "maplibre-basemap-control")], "new"), 0);
  assert.equal(
    basemapInsertIndex(
      [layer("bm1", "maplibre-basemap-control"), layer("bm2", "maplibre-basemap-control"), layer("new", "maplibre-basemap-control")],
      "new",
    ),
    2,
  );
});

test("opaque top basemap occludes those below", () => {
  const bm = (id: string, visible = true, opacity = 1) => ({
    id,
    visible,
    opacity,
    metadata: { sourceKind: "maplibre-basemap-control" as const },
  });
  const data = { id: "data", visible: true, opacity: 1, metadata: {} };
  assert.deepEqual([...occludedBasemapIds([bm("a"), bm("b")])], ["a"]);
  assert.deepEqual([...occludedBasemapIds([bm("a"), bm("b", true, 0.5)])], []);
  assert.deepEqual([...occludedBasemapIds([bm("a"), bm("b", false), bm("c")])], ["b", "a"]);
  assert.deepEqual([...occludedBasemapIds([bm("a"), data, bm("c")])], ["a"]);
});

test("basemapNativeIds includes control layer id", () => {
  assert.deepEqual(
    basemapNativeIds({
      metadata: { nativeLayerIds: ["google-satellite"], basemapId: "google-satellite" },
    }),
    ["google-satellite"],
  );
});

test("drop insert follows reversed UI", () => {
  // store [A B C] UI [C B A]; drop A above C → [B C A]
  assert.equal(dropInsertIndex(["A", "B", "C"], "A", "C", true), 2);
  // drop A below C → [B A C]
  assert.equal(dropInsertIndex(["A", "B", "C"], "A", "C", false), 1);
  assert.equal(dropInsertIndex(["A", "B", "C"], "A", "A", true), null);
});
