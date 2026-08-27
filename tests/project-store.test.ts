import {
  applyGroupEffects,
  DEFAULT_LAYER_STYLE,
  parseProject,
  serializeProject,
  type GeoLibreLayer,
} from "@geolibre/core";
import assert from "node:assert/strict";
import test from "node:test";
import { PENDING_EE_TILES } from "../plugins/earthengine/run";
import { sanitizeGeeProject } from "../src/project-io";
import { projectStore } from "../src/project-store";

test("project round-trip preserves layers, groups, style and view", () => {
  const store = projectStore.getState();
  store.newProject("Demo");
  const groupId = projectStore.getState().addGroup("Hydrology");
  projectStore.getState().updateGroup(groupId, { visible: false, opacity: 0.5 });

  const layer: GeoLibreLayer = {
    id: "rivers",
    name: "Rivers",
    type: "geojson",
    source: { type: "geojson" },
    visible: true,
    opacity: 0.8,
    style: { ...DEFAULT_LAYER_STYLE, strokeColor: "#2563eb" },
    metadata: {},
    groupId,
    geojson: { type: "FeatureCollection", features: [] },
  };
  projectStore.getState().addLayer(layer);
  projectStore.getState().setMapView({
    center: [116.4, 39.9],
    zoom: 8,
    bearing: 12,
    pitch: 30,
  });

  const restored = parseProject(serializeProject(projectStore.getState().project));
  assert.equal(restored.name, "Demo");
  assert.equal(restored.layers[0]?.style.strokeColor, "#2563eb");
  assert.deepEqual(restored.mapView.center, [116.4, 39.9]);

  const [effective] = applyGroupEffects(restored.layers, restored.layerGroups ?? []);
  assert.equal(effective.visible, false);
  assert.equal(effective.opacity, 0.4);
});

test("addLayers writes once", () => {
  projectStore.getState().newProject("Batch");
  let ticks = 0;
  const stop = projectStore.subscribe(() => {
    ticks += 1;
  });
  projectStore.getState().addLayers([
    {
      id: "a",
      name: "A",
      type: "geojson",
      source: { type: "geojson" },
      visible: true,
      opacity: 1,
      style: { ...DEFAULT_LAYER_STYLE },
      metadata: {},
    },
    {
      id: "b",
      name: "B",
      type: "geojson",
      source: { type: "geojson" },
      visible: true,
      opacity: 1,
      style: { ...DEFAULT_LAYER_STYLE },
      metadata: {},
    },
  ]);
  stop();
  assert.equal(ticks, 1);
  assert.deepEqual(
    projectStore.getState().project.layers.map((layer) => layer.id),
    ["a", "b"],
  );
});

test("declared group order controls layer insertion", () => {
  projectStore.getState().newProject("Order");
  const top = projectStore.getState().addGroup("Top");
  const bottom = projectStore.getState().addGroup("Bottom");
  const layer = (id: string, groupId: string): GeoLibreLayer => ({
    id,
    name: id,
    type: "geojson",
    source: { type: "geojson" },
    visible: true,
    opacity: 1,
    style: { ...DEFAULT_LAYER_STYLE },
    metadata: {},
    groupId,
  });
  projectStore.getState().addLayer(layer("top", top));
  projectStore.getState().addLayer(layer("bottom", bottom));
  assert.deepEqual(
    projectStore.getState().project.layers.map((item) => item.id),
    ["bottom", "top"],
  );
});

test("moveLayerToGroup accepts one or many layer ids", () => {
  projectStore.getState().newProject("Groups");
  const groupId = projectStore.getState().addGroup("Demo");
  projectStore.getState().addLayers(
    ["a", "b"].map((id) => ({
      id,
      name: id,
      type: "geojson",
      source: { type: "geojson" },
      visible: true,
      opacity: 1,
      style: { ...DEFAULT_LAYER_STYLE },
      metadata: {},
    })),
  );
  projectStore.getState().moveLayerToGroup(groupId, ["a", "b"]);
  assert.deepEqual(
    projectStore.getState().project.layers.map((layer) => layer.groupId),
    [groupId, groupId],
  );
  projectStore.getState().moveLayerToGroup(undefined, "a");
  assert.deepEqual(
    projectStore.getState().project.layers.map((layer) => layer.groupId),
    [undefined, groupId],
  );
});

test("moveGroup reorders a group block", () => {
  projectStore.getState().newProject("Reorder");
  const g1 = projectStore.getState().addGroup("G1");
  const g2 = projectStore.getState().addGroup("G2");
  projectStore.getState().addLayers(
    ["a", "b", "c", "d"].map((id) => ({
      id,
      name: id,
      type: "geojson",
      source: { type: "geojson" },
      visible: true,
      opacity: 1,
      style: { ...DEFAULT_LAYER_STYLE },
      metadata: {},
    })),
  );
  projectStore.getState().moveLayerToGroup(g1, ["a", "b"]);
  projectStore.getState().moveLayerToGroup(g2, ["c", "d"]);
  projectStore.getState().moveGroup(g1, { type: "group", id: g2 }, true);
  assert.deepEqual(
    projectStore.getState().project.layers.map((layer) => layer.id),
    ["c", "d", "a", "b"],
  );
});

test("load/save drop stale Earth Engine tiles", () => {
  projectStore.getState().newProject("GEE");
  projectStore.getState().addLayers([
    {
      id: "legacy",
      name: "Legacy map",
      type: "xyz",
      source: { type: "raster", tiles: ["https://earthengine.googleapis.com/map/abc/{z}/{x}/{y}"], tileSize: 256 },
      visible: true,
      opacity: 1,
      style: { ...DEFAULT_LAYER_STYLE },
      metadata: { eeAsset: "USGS/SRTMGL1_003", eeKind: "Image", eeVisFp: '{"min":0}' },
    },
    {
      id: "cloud-api",
      name: "Cloud API map",
      type: "xyz",
      source: {
        type: "raster",
        tiles: ["https://earthengine.googleapis.com/v1/projects/demo/maps/abc/tiles/{z}/{x}/{y}"],
        tileSize: 256,
      },
      visible: true,
      opacity: 1,
      style: { ...DEFAULT_LAYER_STYLE },
      metadata: { eeAsset: "USGS/SRTMGL1_003", eeKind: "Image", eeVisFp: '{"min":0}' },
    },
  ]);
  const dirty = projectStore.getState().project;
  const saved = serializeProject(sanitizeGeeProject(dirty));
  assert.equal(saved.includes("eeVisFp"), false);
  assert.equal(saved.includes("eeKind"), false);
  assert.equal(saved.includes("/map/abc/"), false);
  assert.equal(saved.includes("/maps/abc/tiles/"), false);

  projectStore.getState().loadProject(parseProject(serializeProject(dirty)));
  for (const loaded of projectStore.getState().project.layers) {
    assert.equal("eeVisFp" in (loaded.metadata ?? {}), false);
    assert.equal("eeKind" in (loaded.metadata ?? {}), false);
    assert.deepEqual((loaded.source as { tiles?: string[] }).tiles, [PENDING_EE_TILES]);
  }
});
