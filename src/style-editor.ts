import type { GeoLibreLayer, LayerStyle } from "@geolibre/core";
import {
  COLORMAP_OPTIONS,
  COLORMAP_ROW_COUNT,
  colormapsPngUrl,
} from "maplibre-gl-raster";
import { button, field, labeledControl } from "./dom";
import { projectStore } from "./project-store";
import { isProjectRaster, pickRasterState } from "./raster";

export type LayerUiActions = {
  fitLayer(layer: GeoLibreLayer): void;
  removeLayer(layer: GeoLibreLayer): void;
};

const COLORMAPS = [...COLORMAP_OPTIONS].sort((a, b) =>
  a.label.localeCompare(b.label, "en", { sensitivity: "base" }),
);

let host: HTMLElement;
let actions: LayerUiActions;
let styleEditorOpen = false;

export function bindStyleEditor(el: HTMLElement, next: LayerUiActions): void {
  host = el;
  actions = next;
}

export function isStyleEditorOpen(): boolean {
  return styleEditorOpen;
}

export function openLayerStyle(layerId: string): void {
  styleEditorOpen = true;
  projectStore.getState().selectLayer(layerId);
  renderStyleEditor();
}

export function closeStyleEditor(): void {
  if (!styleEditorOpen) return;
  styleEditorOpen = false;
  renderStyleEditor();
}

function applyRampSwatch(el: HTMLElement, name: string, reversed: boolean): void {
  const option = COLORMAP_OPTIONS.find((item) => item.name === name);
  el.style.backgroundImage = option ? `url(${colormapsPngUrl})` : "";
  el.style.backgroundSize = `100% ${COLORMAP_ROW_COUNT * 100}%`;
  el.style.backgroundPosition = option
    ? `0 ${(option.rowIndex / (COLORMAP_ROW_COUNT - 1)) * 100}%`
    : "0 0";
  el.style.transform = reversed ? "scaleX(-1)" : "";
}

function colormapPicker(
  value: string,
  reversed: boolean,
  onChange: (name: string) => void,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "ramp-picker";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "ramp-trigger";
  const swatch = document.createElement("span");
  swatch.className = "ramp-swatch";
  swatch.ariaHidden = "true";
  const caption = document.createElement("span");
  caption.className = "grow";
  const list = document.createElement("div");
  list.className = "ramp-list";
  list.hidden = true;
  list.role = "listbox";

  const paint = (name: string) => {
    applyRampSwatch(swatch, name, reversed);
    caption.textContent = COLORMAP_OPTIONS.find((item) => item.name === name)?.label ?? name;
  };
  paint(value);

  const options = COLORMAPS.some((item) => item.name === value)
    ? COLORMAPS
    : [{ name: value, label: value, rowIndex: 0 }, ...COLORMAPS];
  for (const option of options) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "ramp-option";
    item.role = "option";
    item.ariaSelected = String(option.name === value);
    const preview = document.createElement("span");
    preview.className = "ramp-swatch";
    preview.ariaHidden = "true";
    applyRampSwatch(preview, option.name, reversed);
    const text = document.createElement("span");
    text.className = "grow";
    text.textContent = option.label;
    item.append(preview, text);
    item.addEventListener("click", () => {
      list.hidden = true;
      paint(option.name);
      onChange(option.name);
    });
    list.append(item);
  }

  const close = () => {
    list.hidden = true;
    document.removeEventListener("click", close);
  };
  trigger.append(swatch, caption);
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    if (list.hidden) {
      list.hidden = false;
      queueMicrotask(() => document.addEventListener("click", close));
    } else {
      close();
    }
  });
  wrap.append(trigger, list);
  return wrap;
}

function commitRasterState(layer: GeoLibreLayer, patch: Record<string, unknown>): void {
  const state =
    layer.metadata.rasterState && typeof layer.metadata.rasterState === "object"
      ? (layer.metadata.rasterState as Record<string, unknown>)
      : {};
  projectStore.getState().updateLayer(layer.id, {
    metadata: { ...layer.metadata, rasterState: { ...state, ...patch } },
  });
}

function stylePatch(layer: GeoLibreLayer, patch: Partial<LayerStyle>): void {
  projectStore.getState().updateLayer(layer.id, { style: { ...layer.style, ...patch } });
}

export function renderStyleEditor(): void {
  const { project, selectedLayerId } = projectStore.getState();
  const layer = project.layers.find((candidate) => candidate.id === selectedLayerId);
  host.replaceChildren();
  host.hidden = !layer || !styleEditorOpen;
  if (!layer || !styleEditorOpen) return;

  const heading = document.createElement("div");
  heading.className = "section-title";
  const title = document.createElement("strong");
  title.textContent = "Layer style";
  heading.append(
    title,
    button("×", () => closeStyleEditor(), "关闭"),
  );

  const name = document.createElement("input");
  name.value = layer.name;
  name.addEventListener("change", () =>
    projectStore.getState().updateLayer(layer.id, { name: name.value.trim() || layer.name }),
  );

  const group = document.createElement("select");
  group.append(new Option("No group", ""));
  for (const item of project.layerGroups ?? []) group.append(new Option(item.name, item.id));
  group.value = layer.groupId ?? "";
  group.addEventListener("change", () =>
    projectStore.getState().moveLayerToGroup(layer.id, group.value || undefined),
  );

  const opacity = document.createElement("input");
  opacity.type = "range";
  opacity.min = "0";
  opacity.max = "1";
  opacity.step = "0.05";
  opacity.value = String(layer.opacity);
  opacity.addEventListener("change", () =>
    projectStore.getState().updateLayer(layer.id, { opacity: Number(opacity.value) }),
  );

  host.append(
    heading,
    labeledControl("Name", name),
    labeledControl("Group", group),
    labeledControl(`Opacity ${Math.round(layer.opacity * 100)}%`, opacity),
  );

  if (layer.type === "geojson") {
    const fill = document.createElement("input");
    fill.type = "color";
    fill.value = layer.style.fillColor;
    fill.addEventListener("change", () => stylePatch(layer, { fillColor: fill.value }));

    const stroke = document.createElement("input");
    stroke.type = "color";
    stroke.value = layer.style.strokeColor;
    stroke.addEventListener("change", () => stylePatch(layer, { strokeColor: stroke.value }));

    const width = document.createElement("input");
    width.type = "number";
    width.min = "0";
    width.step = "0.5";
    width.value = String(layer.style.strokeWidth);
    width.addEventListener("change", () => stylePatch(layer, { strokeWidth: Number(width.value) }));

    const radius = document.createElement("input");
    radius.type = "number";
    radius.min = "1";
    radius.value = String(layer.style.circleRadius);
    radius.addEventListener("change", () => stylePatch(layer, { circleRadius: Number(radius.value) }));

    host.append(
      labeledControl("Fill", fill),
      labeledControl("Stroke", stroke),
      labeledControl("Line width", width),
      labeledControl("Point radius", radius),
    );
  } else if (isProjectRaster(layer)) {
    const state = pickRasterState(layer.metadata.rasterState);
    const colormap = state.colormap ?? "viridis";
    const reversed = state.reversed === true;
    const range = state.rescale?.[0];
    const stretch = document.createElement("select");
    for (const value of ["linear", "log", "sqrt"] as const) stretch.append(new Option(value, value));
    stretch.value = state.stretch ?? "linear";
    stretch.addEventListener("change", () => commitRasterState(layer, { stretch: stretch.value }));

    const gamma = document.createElement("input");
    gamma.type = "number";
    gamma.min = "0.1";
    gamma.step = "0.1";
    gamma.value = String(state.gamma ?? 1);
    gamma.addEventListener("change", () => {
      const value = Number(gamma.value);
      commitRasterState(layer, { gamma: value > 0 ? value : 1 });
    });

    const min = document.createElement("input");
    const max = document.createElement("input");
    for (const input of [min, max]) {
      input.type = "number";
      input.placeholder = "auto";
    }
    min.value = range ? String(range[0]) : "";
    max.value = range ? String(range[1]) : "";
    const commitRange = () => {
      const lo = min.value.trim() === "" ? NaN : Number(min.value);
      const hi = max.value.trim() === "" ? NaN : Number(max.value);
      commitRasterState(layer, {
        rescale: Number.isFinite(lo) && Number.isFinite(hi) ? [[lo, hi]] : null,
      });
    };
    min.addEventListener("change", commitRange);
    max.addEventListener("change", commitRange);

    const reverse = document.createElement("input");
    reverse.type = "checkbox";
    reverse.checked = reversed;
    reverse.addEventListener("change", () => commitRasterState(layer, { reversed: reverse.checked }));

    host.append(
      field("Colormap", colormapPicker(colormap, reversed, (name) => commitRasterState(layer, { colormap: name }))),
      labeledControl("Reverse", reverse),
      labeledControl("Min", min),
      labeledControl("Max", max),
      labeledControl("Stretch", stretch),
      labeledControl("Gamma", gamma),
    );
  }

  const row = document.createElement("div");
  row.className = "editor-actions";
  row.append(
    button("Zoom", () => actions.fitLayer(layer)),
    button("Remove", () => actions.removeLayer(layer)),
  );
  host.append(row);
}
