import type { GeoLibreLayer } from "@geolibre/core";
import { getLayerBounds } from "@geolibre/map/headless";
import * as maplibregl from "maplibre-gl";
import { setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import "maplibre-gl-basemap-control/style.css";
import "maplibre-gl-raster/style.css";
import { ee } from "@geolibre/plugins/earthengine";
import { bindWatershedPlugin } from "../plugins/watershed";
import { bindBasemaps } from "./basemap";
import { deleteRasterAsset } from "./assets";
import { element, setStatus } from "./dom";
import {
  bindGeometryEditor,
  cancelGeometryDraft,
  closeGeometryEditor,
  isGeometryEditorOpen,
  openGeometryEditor,
} from "@geolibre/plugins/geometry";
import { bindIdentify, closeIdentify } from "./identify";
import { bindLegend } from "./legend";
import {
  bindLayerTree,
  closeContextMenu,
  contextMenuButton,
  isContextMenuOpen,
  placeContextMenu,
  renderLayers,
} from "./layer-tree";
import {
  deleteRemoteProject,
  downloadProject,
  listRemoteProjects,
  readProjectFile,
  readRemoteProject,
  saveRemoteProject,
} from "./project-io";
import { createProjectFileKey, PROJECT_SUFFIX } from "./project-filename";
import { createProjectRenderer } from "./project-renderer";
import { projectStore } from "./project-store";
import { createRasterAdapter, isProjectRaster, rasterAssetId } from "./raster";
import { loadDemoLayers } from "./samples";
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
const appShell = element<HTMLElement>("app-shell");
const sidebar = element<HTMLElement>("sidebar");
const sidebarToggle = element<HTMLButtonElement>("toggle-sidebar");
const layersPanel = element<HTMLDivElement>("layers");
const layersCollapse = element<HTMLButtonElement>("layers-collapse");
const styleEditor = element<HTMLElement>("style-editor");
const projectBrowser = element<HTMLDialogElement>("project-browser");
const remoteProjects = element<HTMLSelectElement>("remote-projects");
const openSelectedProject = element<HTMLButtonElement>("open-selected-project");
const deleteProject = element<HTMLButtonElement>("delete-project");
const saveProject = element<HTMLButtonElement>("save-project");
const LAST_REMOTE_PROJECT = "geolibre:last-remote-project";
let remoteProjectKey: string | null = null;

function lastRemoteProject(): string | null {
  try {
    return localStorage.getItem(LAST_REMOTE_PROJECT);
  } catch {
    return null;
  }
}

function rememberRemoteProject(key: string): void {
  remoteProjectKey = key;
  try {
    localStorage.setItem(LAST_REMOTE_PROJECT, key);
  } catch {
    // 无本地存储时仍可正常使用 Remote Project。
  }
}

function forgetRemoteProject(key: string): void {
  try {
    if (localStorage.getItem(LAST_REMOTE_PROJECT) === key) {
      localStorage.removeItem(LAST_REMOTE_PROJECT);
    }
  } catch {
    // 无本地存储时无需清理。
  }
}

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

const watershed = bindWatershedPlugin(map, fitLayer, () => {
  closeIdentify();
  closeGeometryEditor();
  if (!basemaps.getState().collapsed) basemaps.collapse();
});
basemaps.on("expand", () => watershed.close());
const layerActions = { fitLayer, removeLayer };
bindStyleEditor(styleEditor, layerActions);
bindLegend(element<HTMLElement>("legend"));
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
  if (watershed.cancel()) return;
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
  if (projectStore.getState().isDirty && !confirm("放弃未保存的修改？")) return;
  remoteProjectKey = null;
  projectStore.getState().newProject("Untitled Project");
  setStatus("已新建 Project");
});

element("import-project").addEventListener("click", () => projectFile.click());
element("export-project").addEventListener("click", async () => {
  try {
    await downloadProject(projectStore.getState().project, remoteProjectKey);
    setStatus("Project 已导出到本地");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
});

async function refreshRemoteProjects(): Promise<void> {
  const projects = await listRemoteProjects();
  remoteProjects.replaceChildren(
    ...projects.map((project) => {
      const option = document.createElement("option");
      option.value = project.key;
      option.textContent = `${project.key}${PROJECT_SUFFIX} — ${new Date(project.updatedAt).toLocaleString()}`;
      option.title = project.name;
      return option;
    }),
  );
  remoteProjects.disabled = !projects.length;
  openSelectedProject.disabled = !projects.length;
  deleteProject.disabled = !projects.length;
}

async function browseRemoteProjects(): Promise<void> {
  try {
    await refreshRemoteProjects();
    projectBrowser.showModal();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

element("open-project").addEventListener("click", () => void browseRemoteProjects());
openSelectedProject.addEventListener("click", async () => {
  const key = remoteProjects.value;
  if (!key || (projectStore.getState().isDirty && !confirm("放弃未保存的修改？"))) return;
  try {
    projectStore.getState().loadProject(await readRemoteProject(key));
    rememberRemoteProject(key);
    projectBrowser.close();
    setStatus("已打开 Remote Project");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
});

deleteProject.addEventListener("click", async () => {
  const key = remoteProjects.value;
  const name = remoteProjects.selectedOptions[0]?.textContent ?? key;
  if (!key || !confirm(`删除 Remote Project“${name}”？`)) return;
  try {
    await deleteRemoteProject(key);
    if (remoteProjectKey === key) remoteProjectKey = null;
    forgetRemoteProject(key);
    await refreshRemoteProjects();
    setStatus("Remote Project 已删除");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
});

saveProject.addEventListener("click", async () => {
  if (saveProject.disabled) return;
  saveProject.disabled = true;
  const project = projectStore.getState().project;
  const previousKey = remoteProjectKey;
  const key = createProjectFileKey(project.name);
  try {
    if (key !== previousKey && (await listRemoteProjects()).some((item) => item.key === key)) {
      throw new Error("同名 Remote Project 已存在，请修改 Project name");
    }
    await saveRemoteProject(key, project);
    rememberRemoteProject(key);
    if (previousKey && previousKey !== key) await deleteRemoteProject(previousKey);
    projectStore.getState().markSaved();
    setStatus("Project 已保存到 Remote");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    saveProject.disabled = false;
  }
});
async function addGee(kind: "Image" | "ImageCollection" | "Feature" | "FeatureCollection"): Promise<void> {
  const id = prompt(`GEE ${kind} ID`)?.trim();
  if (!id) return;
  try {
    await ee.Initialize();
    const src =
      kind === "Image"
        ? ee.Image(id)
        : kind === "ImageCollection"
          ? ee.ImageCollection(id)
          : kind === "Feature"
            ? ee.Feature(id)
            : ee.FeatureCollection(id);
    Map.addLayer(src, null, id.split("/").pop());
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
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
sidebarToggle.addEventListener("click", () => {
  const open = sidebar.hidden;
  const label = open ? "关闭侧边栏" : "打开侧边栏";
  sidebar.hidden = !open;
  appShell.classList.toggle("sidebar-hidden", !open);
  sidebarToggle.dataset.tip = label;
  sidebarToggle.ariaLabel = label;
  sidebarToggle.ariaExpanded = String(open);
  requestAnimationFrame(() => map.resize());
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

async function loadInitialProject(): Promise<void> {
  const key = lastRemoteProject();
  if (key) {
    setStatus("正在打开上次的 Remote Project…");
    try {
      const project = await readRemoteProject(key);
      projectStore.getState().loadProject(project);
      const migrated = (await listRemoteProjects())
        .find((item) => item.aliases?.includes(key))?.key;
      rememberRemoteProject(migrated ?? key);
      layersPanel.classList.remove("booting");
      setStatus("已恢复上次的 Remote Project");
      return;
    } catch {
      // Remote 不可用时退回示例 Project，下次启动继续尝试。
    }
  }

  if (!projectStore.getState().project.layers.length) {
    setStatus("正在加载示例图层…");
    try {
      setStatus(await whenMapLoad().then(loadDemoLayers));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  }
  layersPanel.classList.remove("booting");
}

void loadInitialProject();

projectFile.addEventListener("change", async () => {
  const [file] = projectFile.files ?? [];
  projectFile.value = "";
  if (!file) return;
  if (projectStore.getState().isDirty && !confirm("放弃未保存的修改？")) return;
  try {
    projectStore.getState().loadProject(await readProjectFile(file), true);
    remoteProjectKey = null;
    setStatus(`已从本地导入 ${file.name}`);
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
window.addEventListener(
  "pagehide",
  () => {
    watershed.dispose();
    disposeRenderer();
  },
  { once: true },
);
