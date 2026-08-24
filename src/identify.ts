import type { GeoLibreLayer } from "@geolibre/core";
import { circleLayerId, fillLayerId, lineLayerId } from "@geolibre/map/headless";
import * as maplibregl from "maplibre-gl";
import { isGeometryDrawing } from "./geometry-editor";
import { isGeometryLayer } from "./geometry";
import { projectStore } from "./project-store";
import { isProjectRaster, type RasterAdapter } from "./raster";

const GEOM_STYLE_IDS = ["gee-geom-fill", "gee-geom-line"];

let map: maplibregl.Map;
let button: HTMLButtonElement;
let raster: RasterAdapter;
let active = false;
let popup: maplibregl.Popup | null = null;

export function closeIdentify(): boolean {
  if (!active) return false;
  setIdentify(false);
  return true;
}

export function styleIdsFor(layer: {
  id: string;
  type: string;
  metadata: { sourceKind?: unknown };
}): string[] {
  if (isGeometryLayer(layer)) return GEOM_STYLE_IDS;
  if (layer.type !== "geojson") return [];
  return [fillLayerId(layer.id), lineLayerId(layer.id), circleLayerId(layer.id)];
}

export function formatIdentifyValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function bindIdentify(
  nextMap: maplibregl.Map,
  nextButton: HTMLButtonElement,
  nextRaster: RasterAdapter,
): void {
  map = nextMap;
  button = nextButton;
  raster = nextRaster;
  button.addEventListener("click", () => setIdentify(!active));
  map.on("click", onClick);
  projectStore.subscribe(() => {
    if (active) syncRasterInspect();
  });
}

function setIdentify(next: boolean): void {
  active = next;
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", String(active));
  map.getCanvas().style.cursor = active ? "crosshair" : "";
  syncRasterInspect();
  if (!active) closePopup();
}

function syncRasterInspect(): void {
  if (!active) {
    raster.setInspect(false);
    return;
  }
  const { project, selectedLayerId } = projectStore.getState();
  const selected = project.layers.find((layer) => layer.id === selectedLayerId);
  const target =
    selected && isProjectRaster(selected) && selected.visible
      ? selected
      : [...project.layers].reverse().find((layer) => isProjectRaster(layer) && layer.visible);
  if (!target) {
    raster.setInspect(false);
    return;
  }
  raster.selectRaster(target.id);
  raster.setInspect(true);
}

function onClick(event: maplibregl.MapMouseEvent): void {
  if (!active || isGeometryDrawing()) return;
  const hits = collectHits(map, event.point);
  if (!hits.length) {
    closePopup();
    return;
  }
  closePopup();
  popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, maxWidth: "320px" })
    .setLngLat(event.lngLat)
    .setDOMContent(renderHits(hits))
    .addTo(map);
}

function closePopup(): void {
  popup?.remove();
  popup = null;
}

interface IdentifyHit {
  name: string;
  properties: Record<string, unknown>;
}

function collectHits(target: maplibregl.Map, point: maplibregl.PointLike): IdentifyHit[] {
  const hits: IdentifyHit[] = [];
  for (const layer of [...projectStore.getState().project.layers].reverse()) {
    if (!layer.visible) continue;
    const feature = hitFor(target, point, layer);
    if (feature) hits.push({ name: layer.name, properties: publicProperties(feature.properties) });
  }
  return hits;
}

function hitFor(
  target: maplibregl.Map,
  point: maplibregl.PointLike,
  layer: GeoLibreLayer,
): maplibregl.MapGeoJSONFeature | undefined {
  const ids = styleIdsFor(layer).filter((id) => target.getLayer(id));
  if (!ids.length) return;
  const features = target.queryRenderedFeatures(point, { layers: ids });
  if (isGeometryLayer(layer)) {
    return features.find((feature) => feature.properties?.layerId === layer.id);
  }
  return features[0];
}

function publicProperties(
  properties: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties ?? {})) {
    if (key === "color" || key === "layerId" || key === "index" || key.startsWith("__")) continue;
    next[key] = value;
  }
  return next;
}

function renderHits(hits: IdentifyHit[]): HTMLElement {
  const root = document.createElement("div");
  root.className = "identify-popup";
  for (const hit of hits) {
    const title = document.createElement("div");
    title.className = "identify-title";
    title.textContent = hit.name;
    root.append(title);
    const entries = Object.entries(hit.properties);
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "identify-empty";
      empty.textContent = "无属性";
      root.append(empty);
      continue;
    }
    const table = document.createElement("table");
    for (const [key, value] of entries) {
      const row = document.createElement("tr");
      const th = document.createElement("th");
      th.textContent = key;
      const td = document.createElement("td");
      td.textContent = formatIdentifyValue(value);
      row.append(th, td);
      table.append(row);
    }
    root.append(table);
  }
  return root;
}
