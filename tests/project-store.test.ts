import {
  applyGroupEffects,
  DEFAULT_LAYER_STYLE,
  parseProject,
  serializeProject,
  type GeoLibreLayer,
} from "@geolibre/core";
import assert from "node:assert/strict";
import test from "node:test";
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
