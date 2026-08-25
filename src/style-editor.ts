import type { GeoLibreLayer, LayerStyle } from "@geolibre/core";
import {
  COLORMAP_OPTIONS,
  COLORMAP_ROW_COUNT,
  colormapsPngUrl,
} from "maplibre-gl-raster";
import { button, field, labeledControl } from "./dom";
import { projectStore } from "./project-store";
import { fetchEeBands, isGeeRaster, type EeVis } from "./earthengine";
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

function hex6(value: string): string {
  const hex = value.replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) return hex.split("").map((item) => item + item).join("");
  return /^[0-9a-f]{6}$/i.test(hex) ? hex : "000000";
}

function paletteOf(vis: EeVis): string[] {
  if (Array.isArray(vis.palette)) return vis.palette.map((item) => hex6(String(item)));
  if (typeof vis.palette === "string" && vis.palette.trim()) {
    return vis.palette.split(",").map((item) => hex6(item.trim()));
  }
  return ["000000", "ffffff"];
}

function commitGeeVis(layer: GeoLibreLayer, vis: EeVis): void {
  const prev =
    layer.metadata.rasterState && typeof layer.metadata.rasterState === "object"
      ? { ...layer.metadata.rasterState }
      : {};
  projectStore.getState().updateLayer(layer.id, {
    metadata: {
      ...layer.metadata,
      eeVis: vis,
      eeVisFp: undefined,
      rasterState: {
        ...prev,
        rescale: vis.min != null && vis.max != null ? [[vis.min, vis.max]] : null,
        colormap: vis.palette
          ? Array.isArray(vis.palette)
            ? vis.palette.join(",")
            : vis.palette
          : undefined,
        bands: vis.bands,
      },
    },
  });
}

function geeRadios(
  name: string,
  options: Array<[string, string]>,
  value: string,
  onChange: (value: string) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "gee-vis-row";
  for (const [id, label] of options) {
    const wrap = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = id;
    input.checked = value === id;
    input.addEventListener("change", () => onChange(id));
    wrap.append(input, label);
    row.append(wrap);
  }
  return row;
}

function bandSelect(names: string[], value: string, onChange: (value: string) => void): HTMLSelectElement {
  const select = document.createElement("select");
  const options = names.includes(value) || !value ? names : [value, ...names];
  if (!options.length) options.push(value || "0");
  for (const name of options) select.append(new Option(name, name));
  select.value = value || options[0] || "";
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function geeVisEditor(layer: GeoLibreLayer): HTMLElement[] {
  const vis =
    layer.metadata.eeVis && typeof layer.metadata.eeVis === "object"
      ? ({ ...layer.metadata.eeVis } as EeVis)
      : {};
  const names = Array.isArray(layer.metadata.eeBands) ? layer.metadata.eeBands.map(String) : [];
  const asset = typeof layer.metadata.eeAsset === "string" ? layer.metadata.eeAsset : "";
  const kind = layer.metadata.eeKind === "ImageCollection" ? "ImageCollection" : "Image";
  if (asset && !names.length) {
    void fetchEeBands(asset, kind)
      .then((bands) => {
        if (projectStore.getState().selectedLayerId !== layer.id) return;
        projectStore.getState().updateLayer(layer.id, {
          metadata: { ...layer.metadata, eeBands: bands },
        });
      })
      .catch((error) => console.error(error));
  }
  const current = (vis.bands ?? []).map(String);
  const rgb = current.length >= 3;
  const colorMode = vis.gamma != null && !(vis.palette && (Array.isArray(vis.palette) ? vis.palette.length : vis.palette)) ? "gamma" : "palette";

  const apply = (patch: EeVis) => commitGeeVis(layer, { ...vis, ...patch });

  const title = document.createElement("div");
  title.className = "gee-vis-title";
  title.textContent = "Visualization";

  const mode = geeRadios(
    `gee-mode-${layer.id}`,
    [
      ["1", "1 band (Grayscale)"],
      ["3", "3 bands (RGB)"],
    ],
    rgb ? "3" : "1",
    (value) => {
      const first = current[0] || names[0] || "0";
      apply({
        bands: value === "3" ? [first, current[1] || first, current[2] || first] : [first],
        palette: value === "3" ? undefined : vis.palette ?? paletteOf(vis),
      });
    },
  );

  const bandRow = document.createElement("div");
  bandRow.className = rgb ? "gee-bands rgb" : "gee-bands";
  const pick = (index: number) => (value: string) => {
    const next = rgb ? [current[0] || names[0], current[1] || names[0], current[2] || names[0]] : [current[0] || names[0]];
    next[index] = value;
    apply({ bands: next });
  };
  if (rgb) {
    bandRow.append(
      bandSelect(names, current[0] || names[0] || "", pick(0)),
      bandSelect(names, current[1] || names[1] || names[0] || "", pick(1)),
      bandSelect(names, current[2] || names[2] || names[0] || "", pick(2)),
    );
  } else {
    bandRow.append(bandSelect(names, current[0] || names[0] || "", pick(0)));
  }

  const min = document.createElement("input");
  const max = document.createElement("input");
  min.type = max.type = "number";
  min.value = vis.min == null ? "" : String(vis.min);
  max.value = vis.max == null ? "" : String(vis.max);
  const commitRange = () => {
    const lo = min.value.trim() === "" ? undefined : Number(min.value);
    const hi = max.value.trim() === "" ? undefined : Number(max.value);
    apply({
      min: lo != null && Number.isFinite(lo) ? lo : undefined,
      max: hi != null && Number.isFinite(hi) ? hi : undefined,
    });
  };
  min.addEventListener("change", commitRange);
  max.addEventListener("change", commitRange);
  const range = document.createElement("div");
  range.className = "gee-range";
  const dash = document.createElement("span");
  dash.textContent = "–";
  range.append(min, dash, max);

  const extras: HTMLElement[] = [];
  if (!rgb) {
    extras.push(
      geeRadios(
        `gee-color-${layer.id}`,
        [
          ["gamma", "Gamma"],
          ["palette", "Palette"],
        ],
        colorMode,
        (value) => {
          if (value === "gamma") apply({ gamma: vis.gamma ?? 1, palette: undefined });
          else apply({ gamma: undefined, palette: paletteOf({ ...vis, palette: vis.palette }) });
        },
      ),
    );
    if (colorMode === "gamma") {
      const gamma = document.createElement("input");
      gamma.type = "number";
      gamma.min = "0.1";
      gamma.step = "0.1";
      gamma.value = String(vis.gamma ?? 1);
      gamma.addEventListener("change", () => {
        const value = Number(gamma.value);
        apply({ gamma: value > 0 ? value : 1, palette: undefined });
      });
      extras.push(labeledControl("Gamma", gamma));
    } else {
      const chips = document.createElement("div");
      chips.className = "gee-palette";
      const colors = paletteOf(vis);
      for (const [index, color] of colors.entries()) {
        const input = document.createElement("input");
        input.type = "color";
        input.value = `#${hex6(color)}`;
        input.addEventListener("change", () => {
          const next = [...colors];
          next[index] = hex6(input.value);
          apply({ palette: next, gamma: undefined });
        });
        chips.append(input);
      }
      chips.append(
        button("+", () => apply({ palette: [...colors, colors[colors.length - 1] ?? "ffffff"], gamma: undefined })),
      );
      extras.push(field("Palette", chips));
    }
  }

  return [title, mode, field("Bands", bandRow), field("Range", range), ...extras];
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
  } else if (isGeeRaster(layer)) {
    host.append(...geeVisEditor(layer));
  }

  const row = document.createElement("div");
  row.className = "editor-actions";
  row.append(
    button("Zoom", () => actions.fitLayer(layer)),
    button("Remove", () => actions.removeLayer(layer)),
  );
  host.append(row);
}
