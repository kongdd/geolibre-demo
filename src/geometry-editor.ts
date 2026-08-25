import type { Feature, FeatureCollection, Position } from "geojson";

declare global {
  interface Window {
    __geometryDump?: () => {
      mode: string;
      draft: number;
      open: boolean;
      layers: { name: string; types: string[] }[];
    };
  }
}
import * as maplibregl from "maplibre-gl";
import {
  createGeometryLayer,
  DEFAULT_GEOMETRY_COLOR,
  emptyCollection,
  isGeometryLayer,
  modeStatus,
  nextGeometryColor,
  nextGeometryName,
  geometrySummary,
  dropFeature,
  readLayerProps,
  stampProps,
  withColor,
  type GeometryMode,
} from "./geometry";
import {
  acceptCommit,
  clickDraw,
  emptyDraw,
  finishDraw,
  finishRect,
  previewDraw,
  setDrawMode,
  type DrawState,
} from "./geometry-draw";
import { contextMenuButton, showContextMenu } from "./layer-tree";
import { projectStore } from "./project-store";

const SOURCE = "gee-geom";
const DRAFT = "gee-draft";
const EMPTY = emptyCollection();

let map: maplibregl.Map;
let bar: HTMLElement;
let layerId: string | null = null;
let draw: DrawState = emptyDraw();
let markers: maplibregl.Marker[] = [];
let moved = false;
let skipClick = false;
let downPoint: { x: number; y: number } | null = null;
let downLngLat: Position | null = null;

const ICONS: Record<GeometryMode, string> = {
  pan: `<svg viewBox="0 0 24 24"><path d="M8 11V6.5a1.5 1.5 0 0 1 3 0V11h.5V5.5a1.5 1.5 0 0 1 3 0V11h.5V7a1.5 1.5 0 0 1 3 0v8.5a5 5 0 0 1-5 5H11a5 5 0 0 1-5-5v-3a1.5 1.5 0 0 1 3 0V11Z" fill="currentColor"/></svg>`,
  point: `<svg viewBox="0 0 24 24"><path d="M12 2c3.6 0 6.5 2.9 6.5 6.5 0 4.6-6.5 13-6.5 13S5.5 13.1 5.5 8.5C5.5 4.9 8.4 2 12 2zm0 4.2a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z" fill="currentColor"/></svg>`,
  line: `<svg viewBox="0 0 24 24"><path d="M4 18 18 4" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="4" cy="18" r="2.2" fill="currentColor"/><circle cx="18" cy="4" r="2.2" fill="currentColor"/></svg>`,
  polygon: `<svg viewBox="0 0 24 24"><path d="M6 18 12 5l8 6-3 8H6z" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>`,
  rectangle: `<svg viewBox="0 0 24 24"><rect x="5" y="6" width="14" height="12" rx="1" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>`,
  tilted: `<svg viewBox="0 0 24 24"><path d="M5 15 15 9l3 5-10 6Z" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>`,
  delete: `<svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm-2 6h2v9H7V9zm4 0h2v9h-2V9zm4 0h2v9h-2V9z" fill="currentColor"/></svg>`,
};

export function isGeometryEditorOpen(): boolean {
  return !bar.hidden;
}

export function isGeometryDrawing(): boolean {
  return Boolean(bar) && !bar.hidden && draw.mode !== "pan";
}

export function openGeometryEditor(): void {
  bar.hidden = false;
  ensureLayer();
  paint();
}

export function closeGeometryEditor(): void {
  cancelDraft();
  setMode("pan");
  bar.hidden = true;
  map.getCanvas().style.cursor = "";
  paint();
}

export function cancelGeometryDraft(): boolean {
  if (!draw.draft.length && !draw.rectStart) return false;
  cancelDraft();
  paint();
  return true;
}

export function bindGeometryEditor(nextMap: maplibregl.Map, host: HTMLElement): () => void {
  map = nextMap;
  bar = host;
  bar.className = "geom-bar";
  bar.hidden = true;
  bar.replaceChildren();
  bar.append(tools(), importsPanel(), session());

  map.on("click", onClick);
  map.on("contextmenu", onContextMenu);
  map.on("dblclick", onDblClick);
  map.on("mousedown", onMouseDown);
  map.on("mousemove", onMouseMove);
  map.on("mouseup", onMouseUp);
  map.on("style.load", onStyleLoad);
  window.addEventListener("keydown", onKey);
  const unsub = projectStore.subscribe(paint);
  paint();
  window.__geometryDump = dumpGeometry;

  return () => {
    unsub();
    map.off("click", onClick);
    map.off("contextmenu", onContextMenu);
    map.off("dblclick", onDblClick);
    map.off("mousedown", onMouseDown);
    map.off("mousemove", onMouseMove);
    map.off("mouseup", onMouseUp);
    map.off("style.load", onStyleLoad);
    window.removeEventListener("keydown", onKey);
    clearMarkers();
    delete window.__geometryDump;
  };
}

function dumpGeometry() {
  return {
    mode: draw.mode,
    draft: draw.draft.length,
    open: Boolean(bar) && !bar.hidden,
    layers: projectStore
      .getState()
      .project.layers.filter(isGeometryLayer)
      .map((layer) => ({
        name: layer.name,
        types: (layer.geojson?.features ?? []).map((feature) => feature.geometry.type),
      })),
    top: (map.getStyle()?.layers ?? []).slice(-5).map((layer) => layer.id),
  };
}

function onStyleLoad(): void {
  addSources();
  paint();
}

function onKey(event: KeyboardEvent): void {
  if (event.key === "Enter") finishPath();
}

function tools(): HTMLElement {
  const row = document.createElement("div");
  row.className = "geom-tools";
  for (const item of ["pan", "point", "line", "polygon", "rectangle", "tilted", "delete"] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.mode = item;
    button.title = item === "tilted" ? "tilted rectangle" : item;
    button.innerHTML = ICONS[item];
    button.addEventListener("click", () => {
      bar.hidden = false;
      setMode(item);
    });
    row.append(button);
  }
  return row;
}

function importsPanel(): HTMLElement {
  const box = document.createElement("div");
  box.className = "geom-imports";
  const head = document.createElement("label");
  head.className = "geom-imports-head";
  const all = document.createElement("input");
  all.type = "checkbox";
  all.id = "geom-all-visible";
  all.checked = true;
  all.addEventListener("change", () => {
    for (const layer of projectStore.getState().project.layers.filter(isGeometryLayer)) {
      projectStore.getState().updateLayer(layer.id, { visible: all.checked });
    }
  });
  const title = document.createElement("strong");
  title.textContent = "Geometry Imports";
  head.append(all, title);
  const list = document.createElement("div");
  list.id = "geom-import-list";
  const add = document.createElement("button");
  add.type = "button";
  add.id = "geom-new";
  add.textContent = "+ new layer";
  add.addEventListener("click", addGeometryLayer);
  box.append(head, list, add);
  return box;
}

function session(): HTMLElement {
  const box = document.createElement("div");
  box.className = "geom-session";
  box.append(status(), exitButton());
  return box;
}

function geometriesGroupId(): string {
  const groups = projectStore.getState().project.layerGroups ?? [];
  return groups.find((group) => group.name === "Geometries")?.id ?? projectStore.getState().addGroup("Geometries");
}

function addGeometryToStore(layer: ReturnType<typeof createGeometryLayer>): void {
  layer.groupId = geometriesGroupId();
  projectStore.getState().addLayer(layer);
  const layers = projectStore.getState().project.layers;
  const first = layers.findIndex((item) => item.groupId === layer.groupId);
  if (first >= 0 && layers[first]?.id !== layer.id) projectStore.getState().moveLayer(layer.id, first);
  layerId = layer.id;
}

function addGeometryLayer(): void {
  const layers = projectStore.getState().project.layers.filter(isGeometryLayer);
  addGeometryToStore(
    createGeometryLayer(
      nextGeometryName(layers.map((item) => item.name)),
      nextGeometryColor(layers.map((item) => String(item.metadata.color ?? ""))),
    ),
  );
  projectStore.getState().selectLayer(layerId);
}

function status(): HTMLElement {
  const el = document.createElement("span");
  el.id = "geom-status";
  el.className = "geom-status";
  return el;
}

function exitButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.id = "geom-exit";
  button.textContent = "Exit";
  button.addEventListener("click", () => closeGeometryEditor());
  return button;
}

function setMode(next: GeometryMode): void {
  draw = setDrawMode(next);
  if (next !== "pan" && next !== "delete") ensureLayer();
  map.doubleClickZoom[next === "pan" ? "enable" : "disable"]();
  map.getCanvas().style.cursor = next === "pan" ? "" : next === "delete" ? "pointer" : "crosshair";
  paint();
}

function ensureLayer(): ReturnType<typeof current> {
  const existing = current() ?? projectStore.getState().project.layers.find(isGeometryLayer);
  if (existing) {
    layerId = existing.id;
    projectStore.getState().selectLayer(existing.id);
    return existing;
  }
  const layer = createGeometryLayer();
  addGeometryToStore(layer);
  return layer;
}

function current() {
  const { project, selectedLayerId } = projectStore.getState();
  const selected = project.layers.find((layer) => layer.id === selectedLayerId);
  if (selected && isGeometryLayer(selected)) {
    layerId = selected.id;
    return selected;
  }
  return project.layers.find((layer) => layer.id === layerId) ?? null;
}

function collection(): FeatureCollection {
  return current()?.geojson ?? EMPTY;
}

function color(): string {
  const value = current()?.metadata.color;
  return typeof value === "string" && value ? value : DEFAULT_GEOMETRY_COLOR;
}

function commit(features: Feature[]): void {
  const layer = ensureLayer();
  if (!layer) return;
  projectStore.getState().updateLayer(layer.id, {
    geojson: { type: "FeatureCollection", features },
  });
}

function addFeature(feature: Feature | null): void {
  const accepted = acceptCommit(draw.mode, feature);
  if (!accepted) return;
  const layer = ensureLayer();
  if (!layer) return;
  commit([...collection().features, stampProps(accepted, readLayerProps(layer.metadata))]);
}

function applyStep(step: { state: DrawState; commit: Feature | null }): void {
  draw = step.state;
  addFeature(step.commit);
  paint();
}

function cancelDraft(): void {
  draw = { ...draw, draft: [], rectStart: null };
  downPoint = null;
  downLngLat = null;
  map.dragPan.enable();
}

function dragged(event: maplibregl.MapMouseEvent): boolean {
  return Boolean(
    downPoint && Math.hypot(event.point.x - downPoint.x, event.point.y - downPoint.y) > 4,
  );
}

function onClick(event: maplibregl.MapMouseEvent): void {
  if (skipClick) {
    skipClick = false;
    return;
  }
  if (bar.hidden || dragged(event) || event.originalEvent.detail > 1) return;
  if ((event.originalEvent.target as HTMLElement | null)?.closest(".geom-bar")) return;
  if (draw.mode === "delete") {
    deleteAt(event);
    return;
  }
  if (draw.mode === "pan") return;
  if ((event.originalEvent.target as HTMLElement | null)?.closest(".gee-pin")) return;
  applyStep(clickDraw(draw, [event.lngLat.lng, event.lngLat.lat]));
}

function deleteAt(event: maplibregl.MapMouseEvent): void {
  const hit = hitGeometry(event);
  if (hit) removeHit(hit);
}

function removeHit(hit: { layerId: string; index: number }): void {
  const layer = projectStore.getState().project.layers.find((item) => item.id === hit.layerId);
  if (!layer?.geojson) return;
  projectStore.getState().updateLayer(layer.id, { geojson: dropFeature(layer.geojson, hit.index) });
}

function onContextMenu(event: maplibregl.MapMouseEvent): void {
  if (bar.hidden) return;
  const hit = hitGeometry(event);
  if (!hit) return;
  event.preventDefault();
  showContextMenu(event.originalEvent, [contextMenuButton("删除", () => removeHit(hit), true)]);
}

function hitGeometry(event: maplibregl.MapMouseEvent): { layerId: string; index: number } | null {
  const pin = (event.originalEvent.target as HTMLElement | null)?.closest(".gee-pin");
  if (pin instanceof HTMLElement && pin.dataset.layerId && pin.dataset.index != null) {
    return { layerId: pin.dataset.layerId, index: Number(pin.dataset.index) };
  }
  const ids = [`${SOURCE}-fill`, `${SOURCE}-line`].filter((id) => map.getLayer(id));
  if (!ids.length) return null;
  for (const feature of map.queryRenderedFeatures(event.point, { layers: ids })) {
    const layerId = feature.properties?.layerId;
    const index = Number(feature.properties?.index);
    if (typeof layerId === "string" && Number.isInteger(index)) return { layerId, index };
  }
  return null;
}

function onDblClick(event: maplibregl.MapMouseEvent): void {
  if (draw.mode !== "line" && draw.mode !== "polygon") return;
  event.preventDefault();
  applyStep(finishDraw(draw));
}

function finishPath(): void {
  applyStep(finishDraw(draw));
}

function onMouseDown(event: maplibregl.MapMouseEvent): void {
  moved = false;
  skipClick = false;
  downPoint = event.point;
  downLngLat = [event.lngLat.lng, event.lngLat.lat];
  if (!bar.hidden && draw.mode === "rectangle") map.dragPan.disable();
}

function onMouseMove(event: maplibregl.MapMouseEvent): void {
  if (downPoint && event.originalEvent.buttons) {
    moved = Math.hypot(event.point.x - downPoint.x, event.point.y - downPoint.y) > 4;
  }
  const point: Position = [event.lngLat.lng, event.lngLat.lat];
  if (moved && draw.mode === "rectangle" && downLngLat && !draw.rectStart) {
    draw = { ...draw, rectStart: downLngLat };
  }
  setDraftData(previewDraw(draw, point), draw.draft);
}

function onMouseUp(event: maplibregl.MapMouseEvent): void {
  map.dragPan.enable();
  if (draw.mode !== "rectangle" || !moved) return;
  skipClick = true;
  applyStep(finishRect(draw.rectStart ? draw : { ...draw, rectStart: downLngLat }, [
    event.lngLat.lng,
    event.lngLat.lat,
  ]));
}

const LINE_FILTER: maplibregl.FilterSpecification = [
  "match",
  ["geometry-type"],
  ["LineString", "MultiLineString", "Polygon", "MultiPolygon"],
  true,
  false,
];

function addSources(): void {
  if (map.getLayer(`${SOURCE}-line`)) {
    map.setFilter(`${SOURCE}-line`, LINE_FILTER);
  }
  if (!map.getSource(SOURCE)) {
    map.addSource(SOURCE, { type: "geojson", data: EMPTY });
    map.addLayer({
      id: `${SOURCE}-fill`,
      type: "fill",
      source: SOURCE,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": ["coalesce", ["get", "color"], DEFAULT_GEOMETRY_COLOR],
        "fill-opacity": 0.28,
      },
    });
    map.addLayer({
      id: `${SOURCE}-line`,
      type: "line",
      source: SOURCE,
      filter: LINE_FILTER,
      paint: {
        "line-color": ["coalesce", ["get", "color"], DEFAULT_GEOMETRY_COLOR],
        "line-width": 2,
      },
    });
  }
  if (!map.getSource(DRAFT)) {
    map.addSource(DRAFT, { type: "geojson", data: EMPTY });
    map.addLayer({
      id: `${DRAFT}-fill`,
      type: "fill",
      source: DRAFT,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": DEFAULT_GEOMETRY_COLOR, "fill-opacity": 0.16 },
    });
    map.addLayer({
      id: `${DRAFT}-line`,
      type: "line",
      source: DRAFT,
      paint: { "line-color": DEFAULT_GEOMETRY_COLOR, "line-width": 2, "line-dasharray": [2, 1] },
    });
    map.addLayer({
      id: `${DRAFT}-vertex`,
      type: "circle",
      source: DRAFT,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 4,
        "circle-color": DEFAULT_GEOMETRY_COLOR,
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 1.5,
      },
    });
  }
}

const GEOM_LAYER_IDS = [
  `${SOURCE}-fill`,
  `${SOURCE}-line`,
  `${DRAFT}-fill`,
  `${DRAFT}-line`,
  `${DRAFT}-vertex`,
];

export function raiseGeometryLayers(): void {
  if (!map?.getLayer(GEOM_LAYER_IDS[0])) return;
  for (const id of GEOM_LAYER_IDS) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
}

function setSourceData(id: string, data: FeatureCollection): void {
  const source = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  source?.setData(data);
}

function setDraftData(feature: Feature | null, vertices: Position[] = []): void {
  const points: Feature[] = vertices.map((position) => ({
    type: "Feature",
    properties: { vertex: true },
    geometry: { type: "Point", coordinates: position },
  }));
  setSourceData(DRAFT, {
    type: "FeatureCollection",
    features: feature ? [feature, ...points] : points,
  });
}

function paintedFeatures(): Feature[] {
  const features: Feature[] = [];
  for (const layer of projectStore.getState().project.layers) {
    if (!isGeometryLayer(layer) || !layer.visible) continue;
    const fill = typeof layer.metadata.color === "string" ? layer.metadata.color : DEFAULT_GEOMETRY_COLOR;
    for (const [index, feature] of (layer.geojson?.features ?? []).entries()) {
      features.push({
        ...feature,
        properties: { ...feature.properties, color: fill, layerId: layer.id, index },
      });
    }
  }
  return features;
}

function paint(): void {
  if (!map) return;
  if (map.isStyleLoaded()) addSources();
  const features = paintedFeatures();
  setSourceData(SOURCE, { type: "FeatureCollection", features });
  const fill = color();
  if (map.getLayer(`${DRAFT}-fill`)) {
    map.setPaintProperty(`${DRAFT}-fill`, "fill-color", fill);
    map.setPaintProperty(`${DRAFT}-line`, "line-color", fill);
    map.setPaintProperty(`${DRAFT}-vertex`, "circle-color", fill);
  }
  const cursor = draw.draft.at(-1) ?? draw.rectStart;
  setDraftData(cursor ? previewDraw(draw, cursor) : null, draw.draft);
  syncMarkers(features, true);
  syncBar(current());
  raiseGeometryLayers();
}

function syncBar(layer: ReturnType<typeof current>): void {
  const list = bar.querySelector("#geom-import-list");
  const editing = document.activeElement;
  const renaming =
    list != null &&
    editing instanceof HTMLInputElement &&
    editing.type === "text" &&
    list.contains(editing);
  if (list && !renaming) {
    const layers = projectStore.getState().project.layers.filter(isGeometryLayer).reverse();
    list.replaceChildren(...layers.map((item) => importRow(item, item.id === layer?.id)));
  }
  const statusEl = bar.querySelector("#geom-status");
  const all = bar.querySelector<HTMLInputElement>("#geom-all-visible");
  if (all && document.activeElement !== all) {
    const layers = projectStore.getState().project.layers.filter(isGeometryLayer);
    all.checked = layers.length > 0 && layers.every((item) => item.visible);
  }
  if (statusEl) statusEl.textContent = modeStatus(draw.mode);
  for (const button of bar.querySelectorAll<HTMLButtonElement>(".geom-tools button")) {
    button.classList.toggle("active", button.dataset.mode === draw.mode);
  }
}

function openPropsDialog(layer: {
  id: string;
  name: string;
  geojson?: FeatureCollection;
  metadata: { color?: unknown; props?: unknown };
}): void {
  document.querySelector(".geom-props")?.remove();
  const draft = Object.entries(readLayerProps(layer.metadata)).map(([key, value]) => ({ key, value }));
  const dialog = document.createElement("dialog");
  dialog.className = "geom-props";
  const title = document.createElement("strong");
  title.textContent = `属性 · ${layer.name}`;
  const list = document.createElement("div");
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "+ 添加属性";
  const actions = document.createElement("div");
  actions.className = "geom-props-actions";
  const ok = document.createElement("button");
  ok.type = "button";
  ok.textContent = "确定";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "取消";
  actions.append(ok, cancel);
  dialog.append(title, list, add, actions);

  const paintRows = () => {
    list.replaceChildren();
    if (!draft.length) {
      const empty = document.createElement("p");
      empty.className = "geom-props-empty";
      empty.textContent = "暂无属性。";
      list.append(empty);
      return;
    }
    for (const row of draft) {
      const line = document.createElement("div");
      line.className = "geom-props-row";
      const key = document.createElement("input");
      key.placeholder = "名称";
      key.value = row.key;
      key.addEventListener("input", () => {
        row.key = key.value;
      });
      const value = document.createElement("input");
      value.placeholder = "值";
      value.value = row.value;
      value.addEventListener("input", () => {
        row.value = value.value;
      });
      const drop = document.createElement("button");
      drop.type = "button";
      drop.textContent = "×";
      drop.addEventListener("click", () => {
        draft.splice(draft.indexOf(row), 1);
        paintRows();
      });
      line.append(key, value, drop);
      list.append(line);
    }
  };

  add.addEventListener("click", () => {
    draft.push({ key: "", value: "" });
    paintRows();
    list.querySelector<HTMLInputElement>(".geom-props-row:last-child input")?.focus();
  });
  cancel.addEventListener("click", () => dialog.close());
  ok.addEventListener("click", () => {
    const props: Record<string, string> = {};
    for (const row of draft) {
      const key = row.key.trim();
      if (key) props[key] = row.value;
    }
    const target = projectStore.getState().project.layers.find((item) => item.id === layer.id);
    if (target) {
      projectStore.getState().updateLayer(layer.id, {
        metadata: { ...target.metadata, props },
        geojson: {
          type: "FeatureCollection",
          features: (target.geojson?.features ?? []).map((feature) => stampProps(feature, props)),
        },
      });
    }
    dialog.close();
  });
  dialog.addEventListener("close", () => dialog.remove());
  paintRows();
  document.body.append(dialog);
  dialog.showModal();
}

function importRow(layer: { id: string; name: string; visible: boolean; geojson?: FeatureCollection; metadata: { color?: unknown; props?: unknown } }, selected: boolean): HTMLElement {
  const row = document.createElement("div");
  row.className = `geom-import-row${selected ? " selected" : ""}`;
  const visible = document.createElement("input");
  visible.type = "checkbox";
  visible.checked = layer.visible;
  visible.title = "可见";
  visible.addEventListener("click", (event) => event.stopPropagation());
  visible.addEventListener("change", () => {
    projectStore.getState().updateLayer(layer.id, { visible: visible.checked });
  });
  const name = document.createElement("input");
  name.type = "text";
  name.value = layer.name;
  name.spellcheck = false;
  name.addEventListener("focus", () => selectImport(layer.id));
  name.addEventListener("change", () => {
    projectStore.getState().updateLayer(layer.id, { name: name.value.trim() || "geometry" });
  });
  const count = document.createElement("span");
  count.className = "geom-count";
  count.textContent = geometrySummary(layer.geojson);
  const swatch = document.createElement("input");
  swatch.type = "color";
  swatch.value = typeof layer.metadata.color === "string" ? layer.metadata.color : DEFAULT_GEOMETRY_COLOR;
  swatch.title = "颜色";
  swatch.addEventListener("click", (event) => event.stopPropagation());
  swatch.addEventListener("input", () => {
    const target = projectStore.getState().project.layers.find((item) => item.id === layer.id);
    if (target) projectStore.getState().updateLayer(layer.id, withColor(target, swatch.value));
  });
  const settings = document.createElement("button");
  settings.type = "button";
  settings.className = "geom-del";
  settings.title = "设置";
  settings.textContent = "⚙";
  settings.addEventListener("click", (event) => {
    event.stopPropagation();
    openPropsDialog(layer);
  });
  const del = document.createElement("button");
  del.type = "button";
  del.className = "geom-del";
  del.title = "delete layer";
  del.textContent = "×";
  del.addEventListener("click", (event) => {
    event.stopPropagation();
    if (layer.geojson?.features.length && !confirm(`移除图层“${layer.name}”？`)) return;
    projectStore.getState().removeLayer(layer.id);
  });
  row.append(visible, name, count, swatch, settings, del);
  row.addEventListener("click", () => selectImport(layer.id));
  return row;
}

function selectImport(id: string): void {
  if (layerId === id && projectStore.getState().selectedLayerId === id) return;
  layerId = id;
  projectStore.getState().selectLayer(id);
}

function syncMarkers(features: Feature[], draggable: boolean): void {
  clearMarkers();
  for (const feature of features) {
    if (feature.geometry.type !== "Point") continue;
    const fill =
      typeof feature.properties?.color === "string" ? feature.properties.color : DEFAULT_GEOMETRY_COLOR;
    const owner = typeof feature.properties?.layerId === "string" ? feature.properties.layerId : layerId;
    const index = typeof feature.properties?.index === "number" ? feature.properties.index : -1;
    const pin = document.createElement("div");
    pin.className = "gee-pin";
    if (owner) pin.dataset.layerId = owner;
    pin.dataset.index = String(index);
    pin.innerHTML = `<svg viewBox="0 0 24 36" width="24" height="36" aria-hidden="true"><path fill="${fill}" d="M12 0C5.4 0 0 5.4 0 12c0 8.4 12 24 12 24s12-15.6 12-24C24 5.4 18.6 0 12 0z"/><circle cx="12" cy="12" r="4.2" fill="#fff" fill-opacity=".4"/></svg>`;
    if (owner && index >= 0) {
      pin.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (bar.hidden) return;
        showContextMenu(event, [contextMenuButton("删除", () => removeHit({ layerId: owner, index }), true)]);
      });
    }
    const marker = new maplibregl.Marker({ element: pin, anchor: "bottom", draggable })
      .setLngLat(feature.geometry.coordinates as [number, number])
      .addTo(map);
    if (draggable && owner && index >= 0) {
      marker.on("dragend", () => {
        const lngLat = marker.getLngLat();
        const target = projectStore.getState().project.layers.find((layer) => layer.id === owner);
        if (!target?.geojson) return;
        const next = target.geojson.features.map((item, itemIndex) =>
          itemIndex === index && item.geometry.type === "Point"
            ? { ...item, geometry: { type: "Point" as const, coordinates: [lngLat.lng, lngLat.lat] } }
            : item,
        );
        projectStore.getState().updateLayer(target.id, {
          geojson: { type: "FeatureCollection", features: next },
        });
      });
    }
    markers.push(marker);
  }
}

function clearMarkers(): void {
  for (const marker of markers) marker.remove();
  markers = [];
}
