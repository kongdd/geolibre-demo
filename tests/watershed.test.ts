import { DEFAULT_LAYER_STYLE, type GeoLibreLayer } from "@geolibre/core";
import assert from "node:assert/strict";
import test from "node:test";
import {
  draftsFromLayers,
  formatElapsed,
  outletsToGeoJSON,
  watershedRasterOptions,
} from "../plugins/watershed";

test("formatElapsed uses readable units", () => {
  assert.equal(formatElapsed(35), "35 ms");
  assert.equal(formatElapsed(1234), "1.23 s");
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

test("draftsFromLayers restores extracted pour points", () => {
  const layer: GeoLibreLayer = {
    id: "pour-1",
    name: "Pour_丹江口",
    type: "geojson",
    source: { type: "geojson" },
    geojson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [111, 32] },
          properties: { id: 3, name: "丹江口" },
        },
      ],
    },
    visible: true,
    opacity: 1,
    style: { ...DEFAULT_LAYER_STYLE },
    metadata: { watershedRole: "pour-point", pourPointKey: "k1" },
  };
  assert.deepEqual(draftsFromLayers([layer]), [
    {
      id: 3,
      name: "丹江口",
      lon: 111,
      lat: 32,
      key: "k1",
      selected: false,
      extracted: true,
    },
  ]);
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
