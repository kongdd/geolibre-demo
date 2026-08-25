import type { GeoLibreLayer } from "@geolibre/core";
import { getLayerBounds } from "@geolibre/map/headless";
import * as maplibregl from "maplibre-gl";
import { setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import "maplibre-gl-basemap-control/style.css";
import "maplibre-gl-raster/style.css";
import { ee } from "./earthengine";
import { addDefaultBasemaps, bindBasemaps, flushBootBasemaps } from "./basemap";
import { deleteRasterAsset } from "./assets";
import { element, setStatus } from "./dom";
import {
  bindGeometryEditor,
  cancelGeometryDraft,
  closeGeometryEditor,
  isGeometryEditorOpen,
  openGeometryEditor,
} from "./geometry-editor";
import { bindIdentify, closeIdentify } from "./identify";
import {
  bindLayerTree,
  closeContextMenu,
  contextMenuButton,
  isContextMenuOpen,
  placeContextMenu,
  renderLayers,
} from "./layer-tree";
import { downloadProject, readProjectFile } from "./project-io";
import { createProjectRenderer } from "./project-renderer";
import { projectStore } from "./project-store";
import { createRasterAdapter, isProjectRaster, rasterAssetId } from "./raster";
import { buildSampleLayers } from "./samples";
import {
  bindStyleEditor,
  closeStyleEditor,
  isStyleEditorOpen,
  renderStyleEditor,
} from "./style-editor";

// MapLibre v6 ships its worker separately; Vite must emit and register it.
setWorkerUrl(maplibreWorkerUrl);

const projectName = element<HTMLInputElement>("project-name");
const projectFile = element<HTMLInputElement>("project-file");
const vectorFile = element<HTMLInputElement>("vector-file");
const rasterFile = element<HTMLInputElement>("raster-file");
const layersPanel = element<HTMLDivElement>("layers");
const layersCollapse = element<HTMLButtonElement>("layers-collapse");
const styleEditor = element<HTMLElement>("style-editor");

// MapLibre 6 把 transform 挪到 _camera；deck.gl 仍读 map.transform.height。
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
(window as Window & { __map?: maplibregl.Map }).__map = map;
window.ee = ee;
ee.Initialize();
map.addControl(new maplibregl.NavigationControl(), "top-right");
const geolocate = new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: true,
});
geolocate.on("error", (event) => setStatus(event.message || "定位失败", true));
map.addControl(geolocate, "top-right");
const basemaps = bindBasemaps(map, setStatus);
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
  if (isContextMenuOpen()) return closeContextMenu();
  const ramp = document.querySelector<HTMLElement>(".ramp-list:not([hidden])");
  if (ramp) {
    ramp.hidden = true;
    return;
  }
  if (isStyleEditorOpen()) return closeStyleEditor();
  if (cancelGeometryDraft()) return;
  if (isGeometryEditorOpen()) return closeGeometryEditor();
  if (closeIdentify()) return;
  if (!basemaps.getState().collapsed) return basemaps.collapse();
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
function addGee(kind: "Image" | "ImageCollection" | "Feature" | "FeatureCollection"): void {
  const id = prompt(`GEE ${kind} ID`);
  if (!id?.trim()) return;
  const src =
    kind === "Image"
      ? ee.Image(id.trim())
      : kind === "ImageCollection"
        ? ee.ImageCollection(id.trim())
        : kind === "Feature"
          ? ee.Feature(id.trim())
          : ee.FeatureCollection(id.trim());
  Map.addLayer(src, null, id.trim().split("/").pop());
}

element("add-vector").addEventListener("click", (event) => {
  event.stopPropagation();
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  placeContextMenu(
    [
      contextMenuButton("本地 GeoJSON / Shapefile", () => vectorFile.click()),
      contextMenuButton("GEE Feature", () => addGee("Feature")),
      contextMenuButton("GEE FeatureCollection", () => addGee("FeatureCollection")),
    ],
    rect.left,
    rect.bottom + 4,
  );
});
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
        if (!/^https?:\/\//i.test(url)) return setStatus("Only HTTP(S) URLs are supported", true);
        Map.addLayer(ee.Image(url));
      }),
      contextMenuButton("XYZ", () => {
        const tiles = prompt("XYZ template", "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
        if (!tiles) return;
        Map.addLayer(tiles);
      }),
      contextMenuButton("GEE Image", () => addGee("Image")),
      contextMenuButton("GEE ImageCollection", () => addGee("ImageCollection")),
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

function whenMapLoad(): Promise<void> {
  if (map.loaded()) return Promise.resolve();
  return new Promise((resolve) => map.once("load", () => resolve()));
}

if (!projectStore.getState().project.layers.length) {
  setStatus("正在加载示例图层…");
  void Promise.all([buildSampleLayers(), whenMapLoad().then(() => addDefaultBasemaps(basemaps))])
    .then(async ([sample]) => {
      const store = projectStore.getState();
      const groupId = store.addGroup("Natural Earth");
      for (const layer of sample.layers) layer.groupId = groupId;
      store.addLayers([...flushBootBasemaps(), ...sample.layers]);
      layersPanel.classList.remove("booting");
      setStatus(sample.status);
      try {
        await ee.Initialize();
        store.moveLayerToGroup(
          Map.addLayer(
            ee.Image("USGS/SRTMGL1_003"),
            { min: 0, max: 4000, palette: ["006633", "E5FFCC", "662A00", "D8D8D8", "F5F5F5"] },
            "SRTM",
          ).id,
          groupId,
        );
        setStatus(`${sample.status} / SRTM`);
      } catch (error) {
        console.error(error);
      }
    })
    .catch((error: unknown) => {
      flushBootBasemaps();
      layersPanel.classList.remove("booting");
      setStatus(error instanceof Error ? error.message : String(error), true);
    });
} else {
  flushBootBasemaps();
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
    fitLayer(Map.addLayer(file));
    setStatus(`Added ${file.name}`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
});

rasterFile.addEventListener("change", async () => {
  const [file] = rasterFile.files ?? [];
  rasterFile.value = "";
  if (!file) return;
  try {
    Map.addLayer(file);
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
