import { applyGroupEffects, type GeoLibreLayer } from "@geolibre/core";
import { circleLayerId, fillLayerId, lineLayerId } from "@geolibre/map/headless";
import * as maplibregl from "maplibre-gl";
import { isGeeRaster, sampleGeeLayer } from "@geolibre/plugins/earthengine";
import { isGeometryDrawing, isGeometryLayer } from "@geolibre/plugins/geometry";
import { isBasemapLayer } from "./layer-order";
import { projectStore } from "./project-store";
import { isProjectRaster, type RasterAdapter } from "./raster";

const GEOM_STYLE_IDS = ["gee-geom-fill", "gee-geom-line"];

let map: maplibregl.Map;
let button: HTMLButtonElement;
let raster: RasterAdapter;
let active = false;
let popup: maplibregl.Popup | null = null;
let sampleSeq = 0;

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
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : value.toFixed(4);
  }
  if (typeof value === "string" || typeof value === "boolean") {
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

export function topVisibleLayer(): GeoLibreLayer | undefined {
  const { project } = projectStore.getState();
  const layers = applyGroupEffects(project.layers, project.layerGroups ?? []);
  return [...layers].reverse().find((layer) => layer.visible && !isBasemapLayer(layer) && layer.opacity > 0);
}

function syncRasterInspect(): void {
  const target = active ? topVisibleLayer() : undefined;
  if (!target || !isProjectRaster(target)) {
    raster.setInspect(false);
    return;
  }
  raster.selectRaster(target.id);
  raster.setInspect(true);
}

function onClick(event: maplibregl.MapMouseEvent): void {
  if (!active || isGeometryDrawing()) return;
  const layer = topVisibleLayer();
  if (layer && isGeeRaster(layer)) {
    void identifyGee(layer, event);
    return;
  }
  const feature = layer ? hitFor(map, event.point, layer) : undefined;
  showHits(
    feature && layer ? [{ name: layer.name, properties: publicProperties(feature.properties) }] : [],
    event.lngLat,
  );
}

async function identifyGee(layer: GeoLibreLayer, event: maplibregl.MapMouseEvent): Promise<void> {
  const seq = ++sampleSeq;
  const scale = Number((layer.metadata.eeVis as { scale?: unknown } | undefined)?.scale) || 30;
  showHits([{ name: layer.name, properties: { _: "取样中…" } }], event.lngLat);
  try {
    const values = await sampleGeeLayer(layer, event.lngLat.lng, event.lngLat.lat, scale);
    if (seq !== sampleSeq) return;
    showHits([{ name: layer.name, properties: values }], event.lngLat);
  } catch (error) {
    if (seq !== sampleSeq) return;
    showHits(
      [{ name: layer.name, properties: { error: error instanceof Error ? error.message : String(error) } }],
      event.lngLat,
    );
  }
}

function showHits(hits: IdentifyHit[], lngLat: maplibregl.LngLatLike): void {
  closePopup();
  popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, maxWidth: "320px" })
    .setLngLat(lngLat)
    .setDOMContent(renderHits(hits, maplibregl.LngLat.convert(lngLat), map.getZoom()))
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

function appendTable(root: HTMLElement, rows: Array<[string, unknown]>): void {
  const table = document.createElement("table");
  for (const [key, value] of rows) {
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

function renderHits(hits: IdentifyHit[], lngLat: maplibregl.LngLat, zoom: number): HTMLElement {
  const root = document.createElement("div");
  root.className = "identify-popup";
  appendTable(root, [
    ["lon", lngLat.lng.toFixed(6)],
    ["lat", lngLat.lat.toFixed(6)],
    ["zoom", String(Math.round(zoom))],
  ]);
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
    appendTable(root, entries);
  }
  return root;
}
