import type { Feature, FeatureCollection, Position } from "geojson";
import * as maplibregl from "maplibre-gl";
import {
  createGeometryLayer,
  DEFAULT_GEOMETRY_COLOR,
  emptyCollection,
  isGeometryLayer,
  lineFeature,
  modeStatus,
  nextGeometryColor,
  nextGeometryName,
  pointFeature,
  polygonFeature,
  rectangleRing,
  vertexCount,
  withColor,
  type GeometryMode,
} from "./geometry";
import { projectStore } from "./project-store";

const SOURCE = "gee-geom";
const DRAFT = "gee-draft";
const EMPTY = emptyCollection();

let map: maplibregl.Map;
let bar: HTMLElement;
let mode: GeometryMode = "pan";
let layerId: string | null = null;
let draft: Position[] = [];
let rectStart: Position | null = null;
let markers: maplibregl.Marker[] = [];
let moved = false;
let downPoint: { x: number; y: number } | null = null;

const ICONS: Record<GeometryMode, string> = {
  pan: `<svg viewBox="0 0 24 24"><path d="M8 11V6.5a1.5 1.5 0 0 1 3 0V11h.5V5.5a1.5 1.5 0 0 1 3 0V11h.5V7a1.5 1.5 0 0 1 3 0v8.5a5 5 0 0 1-5 5H11a5 5 0 0 1-5-5v-3a1.5 1.5 0 0 1 3 0V11Z" fill="currentColor"/></svg>`,
  point: `<svg viewBox="0 0 24 24"><path d="M12 2c3.6 0 6.5 2.9 6.5 6.5 0 4.6-6.5 13-6.5 13S5.5 13.1 5.5 8.5C5.5 4.9 8.4 2 12 2zm0 4.2a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z" fill="currentColor"/></svg>`,
  line: `<svg viewBox="0 0 24 24"><path d="M4 18 18 4" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="4" cy="18" r="2.2" fill="currentColor"/><circle cx="18" cy="4" r="2.2" fill="currentColor"/></svg>`,
  polygon: `<svg viewBox="0 0 24 24"><path d="M6 18 12 5l8 6-3 8H6z" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>`,
  rectangle: `<svg viewBox="0 0 24 24"><rect x="5" y="6" width="14" height="12" rx="1" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>`,
};

export function isGeometryEditorOpen(): boolean {
  return !bar.hidden;
}

export function isGeometryDrawing(): boolean {
  return Boolean(bar) && !bar.hidden && mode !== "pan";
}

export function openGeometryEditor(): void {
  bar.hidden = false;
  ensureLayer();
  if (mode === "pan") setMode("pan");
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
  if (!draft.length && !rectStart) return false;
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
  bar.append(tools(), importsPanel(), status(), lockButton(), exitButton());

  map.on("click", onClick);
  map.on("dblclick", onDblClick);
  map.on("mousedown", onMouseDown);
  map.on("mousemove", onMouseMove);
  map.on("mouseup", onMouseUp);
  map.on("style.load", onStyleLoad);
  window.addEventListener("keydown", onKey);
  const unsub = projectStore.subscribe(paint);
  paint();

  return () => {
    unsub();
    map.off("click", onClick);
    map.off("dblclick", onDblClick);
    map.off("mousedown", onMouseDown);
    map.off("mousemove", onMouseMove);
    map.off("mouseup", onMouseUp);
    map.off("style.load", onStyleLoad);
    window.removeEventListener("keydown", onKey);
    clearMarkers();
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
  for (const item of ["pan", "point", "line", "polygon", "rectangle"] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.mode = item;
    button.title = item;
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
  const list = document.createElement("div");
  list.id = "geom-import-list";
  const add = document.createElement("button");
  add.type = "button";
  add.id = "geom-new";
  add.textContent = "+ new layer";
  add.addEventListener("click", addGeometryLayer);
  box.append(list, add);
  return box;
}

function addGeometryLayer(): void {
  const layers = projectStore.getState().project.layers.filter(isGeometryLayer);
  const layer = createGeometryLayer(
    nextGeometryName(layers.map((item) => item.name)),
    nextGeometryColor(layers.map((item) => String(item.metadata.color ?? ""))),
  );
  projectStore.getState().addLayer(layer);
  layerId = layer.id;
  projectStore.getState().selectLayer(layer.id);
  if (mode === "pan") setMode("point");
}

function status(): HTMLElement {
  const el = document.createElement("span");
  el.id = "geom-status";
  el.className = "geom-status";
  return el;
}

function lockButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.id = "geom-lock";
  button.title = "锁定";
  button.addEventListener("click", () => {
    const layer = current();
    if (!layer) return;
    const locked = layer.metadata.locked === true;
    projectStore.getState().updateLayer(layer.id, {
      metadata: { ...layer.metadata, locked: !locked },
    });
  });
  return button;
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
  if (next !== mode) cancelDraft();
  mode = next;
  if (next !== "pan") ensureLayer();
  map.doubleClickZoom[next === "pan" ? "enable" : "disable"]();
  map.getCanvas().style.cursor = next === "pan" ? "" : "crosshair";
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
  projectStore.getState().addLayer(layer);
  layerId = layer.id;
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

function locked(): boolean {
  return current()?.metadata.locked === true;
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
  if (!feature) return;
  if (mode !== "point" && feature.geometry.type === "Point") return;
  commit([...collection().features, feature]);
}

function cancelDraft(): void {
  draft = [];
  rectStart = null;
  downPoint = null;
  map.dragPan.enable();
}

function onClick(event: maplibregl.MapMouseEvent): void {
  if (bar.hidden || mode === "pan" || locked() || moved || event.originalEvent.detail > 1) return;
  if ((event.originalEvent.target as HTMLElement | null)?.closest(".geom-bar, .gee-pin")) return;
  const point: Position = [event.lngLat.lng, event.lngLat.lat];
  if (mode === "point") {
    addFeature(pointFeature(point));
    return;
  }
  if (mode === "line" || mode === "polygon") {
    draft = [...draft, point];
    paint();
    return;
  }
  if (mode === "rectangle") {
    if (!rectStart) {
      rectStart = point;
      return;
    }
    addFeature(polygonFeature(rectangleRing(rectStart, point).slice(0, 4)));
    cancelDraft();
    paint();
  }
}

function onDblClick(event: maplibregl.MapMouseEvent): void {
  if (mode !== "line" && mode !== "polygon") return;
  event.preventDefault();
  finishPath();
}

function finishPath(): void {
  if (mode !== "line" && mode !== "polygon") return;
  addFeature(mode === "line" ? lineFeature(draft) : polygonFeature(draft));
  draft = [];
  paint();
}

function onMouseDown(event: maplibregl.MapMouseEvent): void {
  moved = false;
  downPoint = event.point;
  if (bar.hidden || locked() || mode !== "rectangle") return;
  if (!rectStart) rectStart = [event.lngLat.lng, event.lngLat.lat];
  map.dragPan.disable();
}

function onMouseMove(event: maplibregl.MapMouseEvent): void {
  if (downPoint && event.originalEvent.buttons) {
    moved = Math.hypot(event.point.x - downPoint.x, event.point.y - downPoint.y) > 4;
  }
  const point: Position = [event.lngLat.lng, event.lngLat.lat];
  if (rectStart && mode === "rectangle") {
    setDraftData(polygonFeature(rectangleRing(rectStart, point).slice(0, 4)));
    return;
  }
  if (draft.length && (mode === "line" || mode === "polygon")) {
    setDraftData(mode === "line" ? lineFeature([...draft, point]) : polygonFeature([...draft, point]));
  }
}

function onMouseUp(event: maplibregl.MapMouseEvent): void {
  if (mode !== "rectangle" || !rectStart) return;
  const end: Position = [event.lngLat.lng, event.lngLat.lat];
  const ring = rectangleRing(rectStart, end);
  const wide = Math.abs(ring[0][0] - ring[1][0]) > 1e-6 || Math.abs(ring[0][1] - ring[2][1]) > 1e-6;
  if (wide) {
    addFeature(polygonFeature(ring.slice(0, 4)));
    cancelDraft();
    paint();
  } else if (!moved) {
    map.dragPan.enable();
  }
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
  }
}

function setSourceData(id: string, data: FeatureCollection): void {
  const source = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  source?.setData(data);
}

function setDraftData(feature: Feature | null): void {
  setSourceData(DRAFT, feature ? { type: "FeatureCollection", features: [feature] } : EMPTY);
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
  }
  if (!draft.length && !rectStart) setDraftData(null);
  syncMarkers(features, !locked());
  syncBar(current());
}

function syncBar(layer: ReturnType<typeof current>): void {
  const list = bar.querySelector("#geom-import-list");
  if (list && !list.contains(document.activeElement)) {
    const layers = projectStore.getState().project.layers.filter(isGeometryLayer);
    list.replaceChildren(...layers.map((item) => importRow(item, item.id === layer?.id)));
  }
  const statusEl = bar.querySelector("#geom-status");
  const lock = bar.querySelector<HTMLButtonElement>("#geom-lock");
  if (statusEl) statusEl.textContent = modeStatus(mode);
  if (lock) {
    const on = layer?.metadata.locked === true;
    lock.classList.toggle("on", on);
    lock.title = on ? "解锁" : "锁定";
    lock.textContent = on ? "🔒" : "🔓";
  }
  for (const button of bar.querySelectorAll<HTMLButtonElement>(".geom-tools button")) {
    button.classList.toggle("active", button.dataset.mode === mode);
  }
}

function importRow(layer: { id: string; name: string; visible: boolean; geojson?: FeatureCollection; metadata: { color?: unknown } }, selected: boolean): HTMLElement {
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
  name.addEventListener("click", (event) => event.stopPropagation());
  name.addEventListener("change", () => {
    projectStore.getState().updateLayer(layer.id, { name: name.value.trim() || "geometry" });
  });
  const count = document.createElement("span");
  count.className = "geom-count";
  count.textContent = `(${vertexCount(layer.geojson)} pts)`;
  const swatch = document.createElement("input");
  swatch.type = "color";
  swatch.value = typeof layer.metadata.color === "string" ? layer.metadata.color : DEFAULT_GEOMETRY_COLOR;
  swatch.title = "颜色";
  swatch.addEventListener("click", (event) => event.stopPropagation());
  swatch.addEventListener("input", () => {
    const target = projectStore.getState().project.layers.find((item) => item.id === layer.id);
    if (target) projectStore.getState().updateLayer(layer.id, withColor(target, swatch.value));
  });
  row.append(visible, name, count, swatch);
  row.addEventListener("click", () => {
    layerId = layer.id;
    projectStore.getState().selectLayer(layer.id);
  });
  return row;
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
    pin.innerHTML = `<svg viewBox="0 0 24 36" width="24" height="36" aria-hidden="true"><path fill="${fill}" d="M12 0C5.4 0 0 5.4 0 12c0 8.4 12 24 12 24s12-15.6 12-24C24 5.4 18.6 0 12 0z"/><circle cx="12" cy="12" r="4.2" fill="#fff" fill-opacity=".4"/></svg>`;
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
