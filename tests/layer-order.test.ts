import { DEFAULT_LAYER_STYLE, type GeoLibreLayer, type LayerGroup } from "@geolibre/core";
import assert from "node:assert/strict";
import test from "node:test";
import {
  basemapInsertIndex,
  basemapNativeIds,
  dropGroupOn,
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

const L = (id: string, groupId?: string): GeoLibreLayer => ({
  id,
  name: id,
  type: "geojson",
  source: { type: "geojson" },
  visible: true,
  opacity: 1,
  style: { ...DEFAULT_LAYER_STYLE },
  metadata: {},
  ...(groupId ? { groupId } : {}),
});

const G = (id: string): LayerGroup => ({
  id,
  name: id,
  collapsed: false,
  visible: true,
  opacity: 1,
});

test("drop group above another group", () => {
  const layers = [L("a", "g1"), L("b", "g1"), L("c", "g2"), L("d", "g2")];
  const groups = [G("g1"), G("g2")];
  const moved = dropGroupOn(layers, groups, "g1", { type: "group", id: "g2" }, true);
  assert.deepEqual(moved?.layers.map((layer) => layer.id), ["c", "d", "a", "b"]);
  assert.equal(dropGroupOn(moved!.layers, moved!.groups, "g1", { type: "group", id: "g2" }, true), null);
});

test("drop group below an ungrouped layer", () => {
  const layers = [L("solo"), L("a", "g1"), L("b", "g1")];
  const moved = dropGroupOn(layers, [G("g1")], "g1", { type: "layer", id: "solo" }, false);
  assert.deepEqual(moved?.layers.map((layer) => layer.id), ["a", "b", "solo"]);
});
