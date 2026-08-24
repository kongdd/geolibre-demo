import {
  DEFAULT_LAYER_STYLE,
  type GeoLibreLayer,
} from "@geolibre/core";
import { getLayerBounds } from "@geolibre/map/headless";
import type { FeatureCollection } from "geojson";
import * as maplibregl from "maplibre-gl";
import { BasemapControl } from "maplibre-gl-basemap-control";
import "maplibre-gl/dist/maplibre-gl.css";
import "maplibre-gl-basemap-control/style.css";
import "maplibre-gl-raster/style.css";
import "./maplibre-worker";
import { installBasemapThumbnails } from "./basemap-preview";
import { basemapInsertIndex } from "./layer-order";
import { deleteRasterAsset } from "./assets";
import {
  closeContextMenu,
  contextMenuButton,
  isContextMenuOpen,
  placeContextMenu,
  bindLayerTree,
  renderLayers,
} from "./layer-tree";
import { downloadProject, readProjectFile } from "./project-io";
import { createProjectRenderer, noteLiveStyle } from "./project-renderer";
import { projectStore } from "./project-store";
import {
  createLocalRasterLayer,
  createRasterAdapter,
  createRemoteRasterLayer,
  isProjectRaster,
  rasterAssetId,
} from "./raster";
import {
  bindStyleEditor,
  closeStyleEditor,
  isStyleEditorOpen,
  renderStyleEditor,
} from "./style-editor";
import {
  bindGeometryEditor,
  cancelGeometryDraft,
  closeGeometryEditor,
  isGeometryEditorOpen,
  openGeometryEditor,
} from "./geometry-editor";
import { bindIdentify, closeIdentify } from "./identify";
import { createVectorLayer, readVectorFile } from "./vector";

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value as T;
}

const projectName = element<HTMLInputElement>("project-name");
const projectFile = element<HTMLInputElement>("project-file");
const vectorFile = element<HTMLInputElement>("vector-file");
const rasterFile = element<HTMLInputElement>("raster-file");
const layersPanel = element<HTMLDivElement>("layers");
const layersCollapse = element<HTMLButtonElement>("layers-collapse");
const styleEditor = element<HTMLElement>("style-editor");
const status = element<HTMLElement>("status");

function setStatus(message: string, error = false): void {
  status.textContent = message;
  status.classList.toggle("error", error);
}

// MapLibre 6 把 transform 挪到 _camera；deck.gl 仍读 map.transform.height。
// 发布版 @geolibre/map 尚未带此 shim，demo 必须自己装，否则栅格每帧报错、画面空白。
if (!("transform" in maplibregl.Map.prototype)) {
  Object.defineProperty(maplibregl.Map.prototype, "transform", {
    configurable: true,
    get() {
      return (this as { _camera?: { transform?: unknown } })._camera?.transform;
    },
  });
}

const initial = projectStore.getState().project;
const map = new maplibregl.Map({
  container: "map",
  style: initial.basemapStyleUrl,
  center: initial.mapView.center,
  zoom: initial.mapView.zoom,
  bearing: initial.mapView.bearing,
  pitch: initial.mapView.pitch,
});
map.addControl(new maplibregl.NavigationControl(), "top-right");
const geolocate = new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: true,
});
geolocate.on("error", (event) =>
  setStatus(event.message || "定位失败", true),
);
map.addControl(geolocate, "top-right");
const basemaps = new BasemapControl({
  collapsed: true,
  title: "Basemaps",
  allowMultiple: true,
  confirmStyleReplace: ({ basemap, replacedBasemapIds }) => {
    const count = replacedBasemapIds.length;
    if (count === 0) return true;
    return confirm(
      count === 1
        ? `切换到「${basemap.name}」会移除已叠加的底图，是否继续？`
        : `切换到「${basemap.name}」会移除已叠加的 ${count} 个底图，是否继续？`,
    );
  },
});
function dropBasemapLayers(keepId?: string): void {
  for (const layer of projectStore.getState().project.layers) {
    if (layer.metadata.sourceKind !== "maplibre-basemap-control") continue;
    if (keepId && layer.metadata.basemapId === keepId) continue;
    projectStore.getState().removeLayer(layer.id);
  }
}

basemaps.on("basemapchange", (event) => {
  if (event.type !== "basemapchange") return;
  const { source } = event.basemap;
  if (source.type === "style" || source.type === "vector-style") {
    dropBasemapLayers();
    const url = event.resolvedStyleUrl ?? source.url;
    thumbs.pause();
    noteLiveStyle(url);
    projectStore.getState().setBasemapStyleUrl(url);
    return;
  }
  if (source.type !== "raster" || !event.managedRaster) return;
  if (event.mode !== "add") dropBasemapLayers(event.basemap.id);
  const layer: GeoLibreLayer = {
    id: `basemap-${event.basemap.id}`,
    name: event.basemap.name,
    type: "raster",
    source: {
      type: "raster",
      tiles: source.tiles,
      tileSize: source.tileSize ?? 256,
      attribution: event.basemap.attribution,
    },
    visible: true,
    opacity: 1,
    style: { ...DEFAULT_LAYER_STYLE },
    metadata: {
      sourceKind: "maplibre-basemap-control",
      externalNativeLayer: true,
      nativeLayerIds: [event.managedRaster.layerId],
      sourceId: event.managedRaster.sourceId,
      sourceIds: [event.managedRaster.sourceId],
      basemapId: event.basemap.id,
    },
  };
  commitBasemapLayer(layer);
});
basemaps.on("basemapremove", (event) => {
  if (event.type !== "basemapremove") return;
  const layer = projectStore.getState().project.layers.find(
    (item) => item.metadata.basemapId === event.basemap.id,
  );
  if (layer) projectStore.getState().removeLayer(layer.id);
});
basemaps.on("error", (event) => {
  if (event.type === "error" && event.error) setStatus(event.error.message, true);
});
map.addControl(basemaps, "top-left");
const thumbs = installBasemapThumbnails(basemaps);

const DEFAULT_BASEMAPS = ["google-satellite", "osm-standard"] as const;

let bootBasemaps: GeoLibreLayer[] | null = [];

function commitBasemapLayer(layer: GeoLibreLayer): void {
  const basemapId = layer.metadata.basemapId;
  if (bootBasemaps) {
    if (!bootBasemaps.some((item) => item.metadata.basemapId === basemapId)) bootBasemaps.push(layer);
    return;
  }
  const store = projectStore.getState();
  if (store.project.layers.some((item) => item.metadata.basemapId === basemapId)) return;
  store.addLayer(layer);
  store.moveLayer(layer.id, basemapInsertIndex(store.project.layers, layer.id));
}

async function addDefaultBasemaps(): Promise<void> {
  for (const id of DEFAULT_BASEMAPS) {
    if (!basemaps.isBasemapActive(id)) await basemaps.addBasemap(id);
  }
}

function whenMapLoad(): Promise<void> {
  if (map.loaded()) return Promise.resolve();
  return new Promise((resolve) => {
    map.once("load", () => resolve());
  });
}
(window as Window & { __map?: maplibregl.Map }).__map = map;
map.on("error", (event) => {
  if (event.error) setStatus(event.error.message, true);
});
const rasterAdapter = createRasterAdapter(map, (message) => setStatus(message, true));
const disposeRenderer = createProjectRenderer(map, rasterAdapter);

function fitLayer(layer: GeoLibreLayer): void {
  if (isProjectRaster(layer)) {
    rasterAdapter.zoomTo(layer.id);
    return;
  }
  const bounds = getLayerBounds(layer);
  if (!bounds) return setStatus(`无法获取 ${layer.name} 的范围`, true);
  map.fitBounds(
    [
      [bounds[0], bounds[1]],
      [bounds[2], bounds[3]],
    ],
    { padding: 48, duration: 0 },
  );
}

function removeLayer(layer: GeoLibreLayer): void {
  if (!confirm(`移除图层“${layer.name}”？`)) return;
  const assetId = rasterAssetId(layer);
  const basemapId = layer.metadata.basemapId;
  if (typeof basemapId === "string") void basemaps.removeBasemap(basemapId);
  else projectStore.getState().removeLayer(layer.id);
  if (assetId) void deleteRasterAsset(assetId);
}

const layerActions = { fitLayer, removeLayer };
bindStyleEditor(styleEditor, layerActions);
bindLayerTree(layersPanel, layerActions);
bindGeometryEditor(map, element("geom-bar"));
bindIdentify(map, element("identify"), rasterAdapter);
element("draw-geometry").addEventListener("click", () => {
  closeIdentify();
  openGeometryEditor();
});

function renderUi(): void {
  const state = projectStore.getState();
  if (document.activeElement !== projectName) projectName.value = state.project.name;
  document.title = `${state.isDirty ? "*" : ""}${state.project.name} · Project Demo`;
  renderLayers();
  renderStyleEditor();
}

projectStore.subscribe(renderUi);
renderUi();

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (isContextMenuOpen()) {
    closeContextMenu();
    return;
  }
  const ramp = document.querySelector<HTMLElement>(".ramp-list:not([hidden])");
  if (ramp) {
    ramp.hidden = true;
    return;
  }
  if (isStyleEditorOpen()) {
    closeStyleEditor();
    return;
  }
  if (cancelGeometryDraft()) return;
  if (isGeometryEditorOpen()) {
    closeGeometryEditor();
    return;
  }
  if (closeIdentify()) return;
  if (!basemaps.getState().collapsed) {
    basemaps.collapse();
    return;
  }
  if (!rasterAdapter.collapsed()) rasterAdapter.collapse();
});

projectName.addEventListener("change", () => projectStore.getState().setProjectName(projectName.value));
element("new-project").addEventListener("click", () => {
  if (projectStore.getState().isDirty && !confirm("Discard unsaved changes?")) return;
  projectStore.getState().newProject("Untitled Project");
  setStatus("New project");
});
element("open-project").addEventListener("click", () => projectFile.click());
element("save-project").addEventListener("click", () => {
  downloadProject(projectStore.getState().project);
  projectStore.getState().markSaved();
  setStatus("Project saved");
});
element("add-vector").addEventListener("click", () => vectorFile.click());
element("add-raster").addEventListener("click", (event) => {
  event.stopPropagation();
  const anchor = event.currentTarget as HTMLElement;
  const rect = anchor.getBoundingClientRect();
  placeContextMenu(
    [
      contextMenuButton("本地 GeoTIFF", () => rasterFile.click()),
      contextMenuButton("COG URL", () => {
        const url = prompt("COG URL (requires CORS and HTTP Range)");
        if (!url) return;
        try {
          const parsed = new URL(url);
          if (!/^https?:$/.test(parsed.protocol)) throw new Error("Only HTTP(S) URLs are supported");
          projectStore.getState().addLayer(createRemoteRasterLayer(parsed.toString()));
        } catch (error) {
          setStatus(error instanceof Error ? error.message : String(error), true);
        }
      }),
      contextMenuButton("XYZ", () => {
        const tiles = prompt("XYZ template", "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
        if (!tiles) return;
        projectStore.getState().addLayer({
          id: crypto.randomUUID(),
          name: "XYZ tiles",
          type: "xyz",
          source: {
            type: "raster",
            tiles: [tiles],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
          visible: true,
          opacity: 1,
          style: { ...DEFAULT_LAYER_STYLE },
          metadata: {},
        });
      }),
    ],
    rect.left,
    rect.bottom + 4,
  );
});
layersCollapse.addEventListener("click", () => {
  layersPanel.hidden = !layersPanel.hidden;
  layersCollapse.textContent = layersPanel.hidden ? "▸" : "▾";
  layersCollapse.title = layersPanel.hidden ? "展开 Layers" : "折叠 Layers";
  layersCollapse.ariaExpanded = String(!layersPanel.hidden);
});

element("add-group").addEventListener("click", () => {
  const name = prompt("Group name", "Group");
  if (name !== null) projectStore.getState().addGroup(name);
});

element("add-basemap").addEventListener("click", () => basemaps.expand());

const SAMPLE_DATA = {
  countries:
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson",
  rivers:
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_rivers_lake_centerlines.geojson",
  dem: "https://data.source.coop/giswqs/opengeos/dem.tif",
};

async function fetchCollection(url: string): Promise<FeatureCollection> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载失败 ${response.status}: ${url}`);
  const parsed: unknown = await response.json();
  if (!parsed || typeof parsed !== "object" || (parsed as { type?: unknown }).type !== "FeatureCollection") {
    throw new Error(`不是 FeatureCollection: ${url}`);
  }
  return parsed as FeatureCollection;
}

async function buildSampleLayers(): Promise<{ layers: GeoLibreLayer[]; status: string }> {
  const [countries, rivers] = await Promise.all([
    fetchCollection(SAMPLE_DATA.countries),
    fetchCollection(SAMPLE_DATA.rivers),
  ]);
  const countryLayer = createVectorLayer("国家边界", countries, []);
  countryLayer.style = {
    ...countryLayer.style,
    fillColor: "#8fbc8f22",
    strokeColor: "#3d5a45",
    strokeWidth: 0.8,
  };
  const riverLayer = createVectorLayer("世界河流", rivers, [countryLayer]);
  riverLayer.style = { ...riverLayer.style, strokeColor: "#1d4ed8", strokeWidth: 1.6 };
  const raster = createRemoteRasterLayer(SAMPLE_DATA.dem);
  raster.name = "DEM";
  raster.opacity = 0.85;
  raster.metadata = {
    ...raster.metadata,
    zoomTo: true,
    rasterState: { colormap: "terrain" },
  };
  return {
    layers: [countryLayer, riverLayer, raster],
    status: `已加载国家 ${countries.features.length} / 河流 ${rivers.features.length} / DEM`,
  };
}

async function bootstrapEmptyProject(): Promise<void> {
  setStatus("正在加载示例图层…");
  const [sample] = await Promise.all([
    buildSampleLayers(),
    whenMapLoad().then(() => addDefaultBasemaps()),
  ]);
  const store = projectStore.getState();
  const groupId = store.addGroup("Natural Earth");
  for (const layer of sample.layers) layer.groupId = groupId;
  store.addLayers([...(bootBasemaps ?? []), ...sample.layers]);
  bootBasemaps = null;
  layersPanel.classList.remove("booting");
  setStatus(sample.status);
}

if (!projectStore.getState().project.layers.length) {
  void bootstrapEmptyProject().catch((error) => {
    bootBasemaps = null;
    layersPanel.classList.remove("booting");
    setStatus(error instanceof Error ? error.message : String(error), true);
  });
} else {
  bootBasemaps = null;
  layersPanel.classList.remove("booting");
}

projectFile.addEventListener("change", async () => {
  const [file] = projectFile.files ?? [];
  projectFile.value = "";
  if (!file) return;
  try {
    projectStore.getState().loadProject(await readProjectFile(file));
    setStatus(`Loaded ${file.name}`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
});

vectorFile.addEventListener("change", async () => {
  const [file] = vectorFile.files ?? [];
  vectorFile.value = "";
  if (!file) return;
  try {
    const collections = await readVectorFile(file);
    let first: GeoLibreLayer | null = null;
    for (const [index, collection] of collections.entries()) {
      const name = collection.fileName || (collections.length > 1 ? `${file.name} ${index + 1}` : file.name);
      const layer = createVectorLayer(name, collection, projectStore.getState().project.layers);
      projectStore.getState().addLayer(layer);
      first ??= layer;
    }
    if (first) fitLayer(first);
    setStatus(`Added ${collections.length} vector layer(s)`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
});

rasterFile.addEventListener("change", async () => {
  const [file] = rasterFile.files ?? [];
  rasterFile.value = "";
  if (!file) return;
  try {
    projectStore.getState().addLayer(await createLocalRasterLayer(file));
    setStatus(`Added ${file.name}`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!projectStore.getState().isDirty) return;
  event.preventDefault();
});
window.addEventListener("pagehide", disposeRenderer, { once: true });
