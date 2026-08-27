import { DEFAULT_LAYER_STYLE, type GeoLibreLayer } from "@geolibre/core";
import assert from "node:assert/strict";
import test from "node:test";
import {
  formatElapsed,
  outletsToGeoJSON,
  parsePourPoints,
  watershedRasterOptions,
} from "../plugins/watershed";

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

test("watershed raster selectors use current COG layers", () => {
  const layer = (id: string, name: string, url?: string): GeoLibreLayer => ({
    id,
    name,
    type: "cog",
    source: { type: "raster", ...(url ? { url } : { assetId: id }) },
    visible: true,
    opacity: 1,
    style: { ...DEFAULT_LAYER_STYLE },
    metadata: url ? {} : { localFileName: `${name}.tif` },
  });
  assert.deepEqual(
    watershedRasterOptions([
      layer("dir", "湖北流向", "/project-demo/data/flow%20dir.tif?x=1"),
      layer("acc", "湖北累积流"),
      { ...layer("tiles", "XYZ"), type: "xyz" },
    ]),
    [
      { id: "dir", name: "湖北流向", value: "flow dir.tif" },
      { id: "acc", name: "湖北累积流", value: "湖北累积流.tif" },
    ],
  );
});
