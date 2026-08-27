import { DEFAULT_LAYER_STYLE, type GeoLibreLayer } from "@geolibre/core";
import assert from "node:assert/strict";
import test from "node:test";
import {
  draftsFromLayers,
  formatArea,
  formatElapsed,
  outletsToGeoJSON,
  watershedDeletion,
  watershedRasterOptions,
} from "../plugins/watershed";
import {
  createWatershedExtractor,
  listWatershedRasters,
  WatershedApiError,
} from "../plugins/watershed/client";

test("formats elapsed time and rounded basin area", () => {
  assert.equal(formatElapsed(35), "35 ms");
  assert.equal(formatElapsed(1234), "1.23 s");
  assert.equal(formatArea(1234.6), "1,235 km²");
  assert.equal(formatArea(), "— km²");
});

const emptyCollection = JSON.stringify({ type: "FeatureCollection", features: [] });

function watershedResponse(watershed: string | null = emptyCollection): Response {
  return new Response(
    JSON.stringify({
      watershed_geojson: watershed,
      pour_points_geojson: emptyCollection,
      basin_stats: [],
      walls_ms: 7,
    }),
  );
}

test("watershed client posts outlets and parses GeoJSON", async () => {
  let body: Record<string, unknown> = {};
  const fetchFn: typeof globalThis.fetch = async (input, init) => {
    assert.equal(input, "/project-demo/api/watershed");
    body = JSON.parse(String(init?.body));
    return watershedResponse();
  };
  const result = await createWatershedExtractor({
    baseUrl: "/project-demo/api",
    fetch: fetchFn,
  }).extract({ lon: 110.8, lat: 32.6 });

  assert.deepEqual((body.points as unknown[])[0], { id: 1, lon: 110.8, lat: 32.6 });
  assert.equal(body.snap_dist_m, 200);
  assert.equal(result.watershed?.type, "FeatureCollection");
});

test("watershed client lists and sends selected rasters", async () => {
  const bodies: Record<string, unknown>[] = [];
  const fetchFn: typeof globalThis.fetch = async (_input, init) => {
    if (!init) return Response.json({ flowdirs: ["flowdir.tif"], flowaccus: ["flowaccu.tif"] });
    bodies.push(JSON.parse(String(init.body)));
    return watershedResponse();
  };
  const rasters = await listWatershedRasters({ fetch: fetchFn });
  await createWatershedExtractor({
    fetch: fetchFn,
    flowdir: rasters.flowdirs[0],
    flowaccu: rasters.flowaccus[0],
  }).extract({ lon: 110.8, lat: 32.6 });

  assert.equal(bodies[0]?.flowdir, "flowdir.tif");
  assert.equal(bodies[0]?.flowaccu, "flowaccu.tif");
});

test("watershed client requires FlowAccum only when snapping", () => {
  assert.throws(
    () => createWatershedExtractor({ flowdir: "flowdir.tif", snapDistanceM: 1 }),
    /FlowAccum/,
  );
  assert.doesNotThrow(() =>
    createWatershedExtractor({ flowdir: "flowdir.tif", snapDistanceM: 0 }),
  );
});

test("watershed client supports multiple outlets and nullable polygons", async () => {
  let body: Record<string, unknown> = {};
  const fetchFn: typeof globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return watershedResponse(null);
  };
  const result = await createWatershedExtractor({ fetch: fetchFn }).extract([
    { lon: 110.8, lat: 32.6 },
    { id: 7, lon: 110.9, lat: 32.7 },
  ]);

  assert.deepEqual(body.points, [
    { id: 1, lon: 110.8, lat: 32.6 },
    { id: 7, lon: 110.9, lat: 32.7 },
  ]);
  assert.equal(result.watershed, null);
});

test("watershed client surfaces backend errors", async () => {
  const fetchFn: typeof globalThis.fetch = async () =>
    new Response("outside DEM", { status: 400 });
  await assert.rejects(
    () => createWatershedExtractor({ fetch: fetchFn }).extract({ lon: 0, lat: 0 }),
    (error) => error instanceof WatershedApiError && error.status === 400,
  );
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

test("defaults unnamed outlets to station IDs", () => {
  const layer: GeoLibreLayer = {
    id: "pour-1",
    name: "legacy",
    type: "geojson",
    source: { type: "geojson" },
    geojson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [111, 32] },
          properties: { id: 3 },
        },
      ],
    },
    visible: true,
    opacity: 1,
    style: { ...DEFAULT_LAYER_STYLE },
    metadata: { watershedRole: "pour-point" },
  };
  assert.equal(draftsFromLayers([layer])[0]?.name, "站点3");
});

test("restores extracted pour points and plans precise deletion", () => {
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
    metadata: {
      watershedName: "流域 1",
      watershedRole: "pour-point",
      pourPointKey: "k1",
      watershedAreaKm2: 12.6,
    },
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
      areaKm2: 12.6,
    },
  ]);

  const basin = {
    ...layer,
    id: "basin-1",
    name: "流域 1",
    geojson: {
      ...layer.geojson!,
      features: [
        ...layer.geojson!.features,
        { ...layer.geojson!.features[0]!, properties: { id: 4, name: "郧阳" } },
      ],
    },
    metadata: { watershedName: "流域 1", watershedRole: "basin" },
  };
  const deletion = watershedDeletion([basin, layer], "k1")!;
  assert.deepEqual(deletion.removeLayerIds, ["pour-1"]);
  assert.deepEqual(
    deletion.basinUpdates[0]?.geojson.features.map((feature) => feature.properties?.id),
    [4],
  );
  const last = watershedDeletion([{ ...basin, geojson: layer.geojson }, layer], "k1")!;
  assert.deepEqual(last.removeLayerIds, ["pour-1", "basin-1"]);
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
