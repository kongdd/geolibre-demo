import { applyGroupEffects, type GeoLibreLayer } from "@geolibre/core";
import { COLORMAP_OPTIONS, COLORMAP_ROW_COUNT, colormapsPngUrl } from "maplibre-gl-raster";
import { projectStore } from "./project-store";
import { isGeeRaster, type EeVis } from "@geolibre/plugins/earthengine";
import { isProjectRaster, pickRasterState } from "./raster";

let host: HTMLElement;

/** "#rgb" → "rrggbb"，其余原样返回（去 #）。 */
export function normalizeHex(color: string): string {
  const hex = color.replace(/^#/, "");
  return /^[0-9a-f]{3}$/i.test(hex)
    ? hex
        .split("")
        .map((item) => item + item)
        .join("")
    : hex;
}

/** 解析逗号分隔的十六进制色串（GEE palette 落盘格式），非法则返回 null。 */
export function parseColorCsv(value: string): string[] | null {
  const parts = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length < 2 || !parts.every((item) => /^[0-9a-f]{3,6}$/i.test(normalizeHex(item)))) {
    return null;
  }
  return parts.map((item) => normalizeHex(item));
}

function rampBar(colormap?: string): HTMLElement {
  const bar = document.createElement("span");
  bar.className = "legend-bar";
  const colors = colormap ? parseColorCsv(colormap) : null;
  if (colors) {
    bar.style.background = `linear-gradient(to right, ${colors.map((color) => `#${color}`).join(", ")})`;
    return bar;
  }
  const option = COLORMAP_OPTIONS.find((item) => item.name === (colormap ?? "viridis"));
  if (!option) return bar;
  bar.style.backgroundImage = `url(${colormapsPngUrl})`;
  bar.style.backgroundSize = `100% ${COLORMAP_ROW_COUNT * 100}%`;
  bar.style.backgroundPosition = `0 ${(option.rowIndex / (COLORMAP_ROW_COUNT - 1)) * 100}%`;
  return bar;
}

function legendSwatch(layer: GeoLibreLayer): HTMLElement {
  const swatch = document.createElement("span");
  swatch.className = "legend-swatch";
  swatch.style.background = layer.style.fillColor;
  swatch.style.borderColor = layer.style.strokeColor;
  swatch.style.borderWidth = `${Math.min(2, layer.style.strokeWidth)}px`;
  return swatch;
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value !== 0 && (Math.abs(value) >= 1e5 || Math.abs(value) < 1e-3)) return value.toExponential(2);
  return String(Number(value.toPrecision(4)));
}

function legendLabels(min?: number, max?: number): HTMLElement | null {
  if (min == null || max == null || !Number.isFinite(min) || !Number.isFinite(max)) return null;
  const row = document.createElement("div");
  row.className = "legend-labels";
  for (const value of [formatValue(min), formatValue(max)]) {
    const span = document.createElement("span");
    span.textContent = value;
    row.append(span);
  }
  return row;
}

function legendItem(layer: GeoLibreLayer): HTMLElement {
  const box = document.createElement("div");
  box.className = "legend-item";
  const title = document.createElement("div");
  title.className = "legend-title";
  title.textContent = layer.name;
  box.append(title);

  if (layer.type === "geojson") {
    box.append(legendSwatch(layer));
    return box;
  }

  let colormap: string | undefined;
  let reversed = false;
  let min: number | undefined;
  let max: number | undefined;
  if (isProjectRaster(layer)) {
    const state = pickRasterState(layer.metadata.rasterState);
    colormap = state.colormap;
    reversed = state.reversed === true;
    [min, max] = state.rescale?.[0] ?? [];
  } else if (isGeeRaster(layer)) {
    const vis = (layer.metadata.eeVis ?? {}) as EeVis;
    colormap = Array.isArray(vis.palette) ? vis.palette.join(",") : vis.palette;
    min = typeof vis.min === "number" ? vis.min : undefined;
    max = typeof vis.max === "number" ? vis.max : undefined;
  }
  if (colormap) {
    const bar = rampBar(colormap);
    if (reversed) bar.style.transform = "scaleX(-1)";
    box.append(bar);
    const labels = legendLabels(min, max);
    if (labels) box.append(labels);
  }
  return box;
}

function render(): void {
  const { project } = projectStore.getState();
  const layers = applyGroupEffects(project.layers, project.layerGroups ?? []).filter(
    (layer) => layer.visible && layer.metadata.showLegend === true,
  );
  host.hidden = !layers.length;
  host.replaceChildren(...layers.map(legendItem));
}

export function bindLegend(el: HTMLElement): void {
  host = el;
  projectStore.subscribe(render);
  render();
}
