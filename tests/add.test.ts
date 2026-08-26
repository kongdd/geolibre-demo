import assert from "node:assert/strict";
import test from "node:test";
import {
  addLayer,
  addMarker,
  asCollection,
  bindEarthEngine,
  ee,
  isEe,
  isGeeRaster,
  isLocalImageSrc,
  isLocalVectorSrc,
  isOfficialEe,
  layersOf,
  sniff,
  tilesFromMapId,
  visToOpts,
} from "@geolibre/plugins/earthengine";
import { isGeometryLayer } from "../src/geometry";
import { projectStore } from "../src/project-store";

test("sniff url / hint", () => {
  assert.equal(sniff("https://a/{z}/{x}/{y}.png"), "xyz");
  assert.equal(sniff("https://a/dem.tif"), "cog");
  assert.equal(sniff("https://a/dem.tiff?x=1"), "cog");
  assert.equal(sniff("https://a/data.geojson"), "geojson");
  assert.equal(sniff("https://a/{z}/{x}/{y}.png", "cog"), "cog");
});

test("asCollection wraps Feature and Geometry", () => {
  const feature = asCollection({
    type: "Feature",
    properties: {},
    geometry: { type: "Point", coordinates: [116, 40] },
  });
  assert.equal(feature.features.length, 1);
  const geom = asCollection({ type: "Point", coordinates: [0, 0] });
  assert.equal(geom.features[0]?.geometry.type, "Point");
  assert.throws(() => asCollection({ foo: 1 }));
});

test("layersOf geojson + style", async () => {
  const [layer] = await layersOf(
    {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
        },
      ],
    },
    { name: "Rivers", stroke: "#1d4ed8", width: 1.6 },
  );
  assert.equal(layer.name, "Rivers");
  assert.equal(layer.type, "geojson");
  assert.equal(layer.style.strokeColor, "#1d4ed8");
  assert.equal(layer.style.strokeWidth, 1.6);
});

test("layersOf xyz", async () => {
  const url = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const [layer] = await layersOf(url, { name: "OSM" });
  assert.equal(layer.type, "xyz");
  assert.equal(layer.name, "OSM");
  assert.deepEqual(layer.source.tiles, [url]);
});

test("visToOpts maps GEE vis / name / shown / opacity", () => {
  const opts = visToOpts({ color: "1d4ed8", width: 2, min: 0, max: 3000, palette: "terrain" }, "DEM", false, 0.5);
  assert.equal(opts.color, "#1d4ed8");
  assert.equal(opts.width, 2);
  assert.equal(opts.colormap, "terrain");
  assert.deepEqual(opts.rescale, [[0, 3000]]);
  assert.equal(opts.name, "DEM");
  assert.equal(opts.visible, false);
  assert.equal(opts.opacity, 0.5);
});

test("local vs remote src sniff", () => {
  assert.equal(isLocalImageSrc("https://a/dem.tif"), true);
  assert.equal(isLocalImageSrc("USGS/SRTMGL1_003"), false);
  assert.equal(isLocalVectorSrc({ type: "FeatureCollection", features: [] }), true);
  assert.equal(isLocalVectorSrc("FAO/GAUL/2015/level0"), false);
  const fakeApi = {
    Image: class {
      getMap() {}
    },
    Feature: class {},
    FeatureCollection: class {},
    ImageCollection: class {},
  };
  const bound = bindEarthEngine(fakeApi as never);
  assert.equal(isOfficialEe(bound.Image("USGS/SRTMGL1_003")), true);
  assert.equal(isEe(bound.Image("https://a/dem.tif")), true);
});

test("GEE assets require initialization", () => {
  projectStore.getState().newProject("GEE");
  assert.throws(() => Map.addLayer(ee.Image("USGS/SRTMGL1_003")), /Initialize/);
  assert.throws(() => Map.addLayer(ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")), /Initialize/);
  assert.throws(() => Map.addLayer(ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017")), /Initialize/);
});

test("serialized official image stores eeExpr", () => {
  projectStore.getState().newProject("EXPR");
  const obj = {
    serialize: () =>
      JSON.stringify({
        result: "0",
        values: {
          "0": {
            functionInvocationValue: {
              functionName: "Image.load",
              arguments: { id: { constantValue: "USGS/SRTMGL1_003" } },
            },
          },
        },
      }),
    name: () => "Image",
    getMap() {},
  };
  const layer = Map.addLayer(obj, { min: 0, max: 1 }, "SRTM");
  assert.equal(layer.type, "xyz");
  assert.equal(isGeeRaster(layer), true);
  assert.equal((layer.metadata.eeExpr as { result?: string })?.result, "0");
  assert.equal("eeKind" in layer.metadata, false);
});

test("official EE getMap becomes xyz tiles", () => {
  assert.equal(isOfficialEe({ getMap() {} }), true);
  assert.equal(isOfficialEe(ee.Image("https://a/dem.tif")), false);
  assert.equal(tilesFromMapId({ mapid: "abc", token: "t" }), "https://earthengine.googleapis.com/map/abc/{z}/{x}/{y}");
  projectStore.getState().newProject("EE");
  const obj = {
    getMap(_vis: object, callback?: (map: unknown) => void) {
      callback?.({ urlFormat: "https://earthengine.googleapis.com/map/x/{z}/{x}/{y}" });
    },
  };
  const layer = Map.addLayer(obj, { min: 0, max: 1 }, "SRTM");
  assert.equal(layer.type, "xyz");
  assert.equal(layer.name, "SRTM");
});

test("ee types dispatch vector vs raster", () => {
  projectStore.getState().newProject("Ee");
  const feat = Map.addLayer(
    ee.Feature({ type: "Point", coordinates: [116, 40] }),
    { color: "1565c0" },
    "pt",
  );
  assert.equal(feat.type, "geojson");
  assert.equal(feat.geojson?.features[0]?.geometry.type, "Point");
  const img = Map.addLayer(ee.Image("https://a/dem.tif"), { palette: "terrain", min: 0, max: 100 }, "DEM");
  assert.equal(img.type, "cog");
  assert.equal(img.metadata.rasterState && (img.metadata.rasterState as { colormap?: string }).colormap, "terrain");
  const stack = Map.addLayer(ee.ImageCollection(["https://a/a.tif", "https://a/b.tif"]), null, "stack");
  assert.equal(stack.type, "cog");
  assert.equal(stack.source.url, "https://a/a.tif");
});

test("Map.addLayer is sync like GEE", () => {
  assert.equal(globalThis.Map.addLayer, addLayer);
  assert.equal(new globalThis.Map([[1, 2]]).get(1), 2);
  projectStore.getState().newProject("Map");
  const layer = Map.addLayer(
    { type: "FeatureCollection", features: [] },
    { color: "c62828", width: 2 },
    "Rivers",
    false,
    0.4,
  );
  assert.equal(typeof (layer as { then?: unknown }).then, "undefined");
  assert.equal(layer.name, "Rivers");
  assert.equal(layer.visible, false);
  assert.equal(layer.opacity, 0.4);
  assert.equal(layer.style.strokeColor, "#c62828");
  assert.equal(layer.style.strokeWidth, 2);
});

test("Map.addLayer + addMarker write store", () => {
  projectStore.getState().newProject("Add");
  Map.addLayer({ type: "FeatureCollection", features: [] }, null, "Empty");
  const pt = addMarker([116.4, 39.9], { name: "pt", color: "#1565c0" });
  const names = projectStore.getState().project.layers.map((layer) => layer.name);
  assert.deepEqual(names, ["Empty", "pt"]);
  assert.equal(isGeometryLayer(pt), true);
  assert.equal(pt.geojson?.features[0]?.geometry.type, "Point");
});
