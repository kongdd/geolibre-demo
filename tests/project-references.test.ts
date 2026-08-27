import {
  createEmptyProject,
  DEFAULT_LAYER_STYLE,
  parseProject,
  type GeoLibreLayer,
  type GeoLibreProject,
} from "@geolibre/core";
import assert from "node:assert/strict";
import test from "node:test";
import { createProjectFileKey } from "../src/project/filename";
import {
  hydrateProjectData,
  prepareProjectForStorage,
  serializeStoredProject,
} from "../src/project/io";

function project(): GeoLibreProject {
  const layer: GeoLibreLayer = {
    id: "basin",
    name: "汉江流域",
    type: "geojson",
    source: { type: "geojson" },
    geojson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [111, 32] },
          properties: { name: "丹江口" },
        },
      ],
    },
    visible: true,
    opacity: 1,
    style: { ...DEFAULT_LAYER_STYLE },
    metadata: {},
  };
  return { ...createEmptyProject("Watershed"), layers: [layer] };
}

test("project storage writes GeoJSON separately and keeps only its path", async () => {
  const originalFetch = globalThis.fetch;
  const files = new Map<string, string>();
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === "PUT") {
      files.set(url, String(init.body));
      return new Response('{"ok":true}', { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const body = files.get(url);
    return body === undefined
      ? new Response("missing", { status: 404 })
      : new Response(body, { status: 200, headers: { "Content-Type": "application/geo+json" } });
  };

  try {
    const stored = await prepareProjectForStorage("Watershed-1234", project());
    const layer = stored.layers[0]!;
    assert.equal(layer.geojson, undefined);
    assert.match(decodeURIComponent(String(layer.source.url)), /Watershed-1234\/data\/汉江流域\.geojson$/);
    const content = serializeStoredProject(stored);
    assert.equal(content.includes('"coordinates"'), false);
    assert.equal(content.includes('"fillPattern"'), false);
    assert.deepEqual(parseProject(content).layers[0]?.style, layer.style);
    assert.equal(files.size, 1);

    const hydrated = await hydrateProjectData(stored);
    assert.deepEqual(hydrated.layers[0]?.geojson?.features[0]?.properties, { name: "丹江口" });
    await assert.rejects(() => prepareProjectForStorage(null, project()), /请先保存到 Remote/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("watershed layers store GeoJSON under data/Basins", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('{"ok":true}', { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    const layer: GeoLibreLayer = {
      ...project().layers[0]!,
      name: "流域 1",
      metadata: { watershedName: "流域 1", watershedRole: "basin" },
    };
    const stored = await prepareProjectForStorage("Watershed-1234", {
      ...createEmptyProject("Watershed"),
      layers: [layer],
    });
    assert.equal(stored.layers[0]?.metadata.projectAsset, "Basins/流域_1.geojson");
    assert.match(
      decodeURIComponent(String(stored.layers[0]?.source.url)),
      /data\/Basins\/流域_1\.geojson$/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("project filenames use only the project name", () => {
  assert.equal(createProjectFileKey("丹江口 Project"), "丹江口_Project");
});
