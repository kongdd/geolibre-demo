import {
  createWatershedExtractor,
  listWatershedRasters,
  type Outlet,
} from "@spatialhydro/watershed";
import type { GeoLibreLayer } from "@geolibre/core";
import type { FeatureCollection } from "geojson";
import { Marker, type Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import { setStatus } from "../../src/dom";
import { projectStore } from "../../src/project-store";
import { createVectorLayer } from "../../src/vector";

export interface WatershedPlugin {
  cancel(): boolean;
  dispose(): void;
}

export function formatElapsed(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export interface NamedOutlet extends Outlet {
  id: number;
  name: string;
}

export function parsePourPoints(text: string): NamedOutlet[] {
  const points = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const fields = line.includes(",")
        ? line.split(",").map((value) => value.trim())
        : line.split(/\s+/);
      const numeric = fields.map(Number);
      let [id, name, lon, lat]: [number, string, number, number] = [
        index + 1,
        `出水口 ${index + 1}`,
        Number.NaN,
        Number.NaN,
      ];
      if (fields.length === 2) [lon, lat] = numeric;
      else if (fields.length === 3 && numeric.every(Number.isFinite)) {
        [id, lon, lat] = numeric;
        name = `出水口 ${id}`;
      } else if (fields.length === 3) [name, lon, lat] = [fields[0]!, numeric[1]!, numeric[2]!];
      else if (fields.length === 4) [id, name, lon, lat] = [numeric[0]!, fields[1]!, numeric[2]!, numeric[3]!];
      if (
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        !name ||
        !Number.isFinite(lon) ||
        lon < -180 ||
        lon > 180 ||
        !Number.isFinite(lat) ||
        lat < -90 ||
        lat > 90
      ) {
        throw new Error(`出水口第 ${index + 1} 行格式应为 名称,经度,纬度`);
      }
      return { id, name, lon, lat };
    });
  if (!points.length) throw new Error("请输入至少一个出水口");
  if (new Set(points.map(({ id }) => id)).size !== points.length) {
    throw new Error("出水口 ID 不能重复");
  }
  if (new Set(points.map(({ name }) => name)).size !== points.length) {
    throw new Error("出水口名称不能重复");
  }
  return points;
}

export function outletsToGeoJSON(outlets: NamedOutlet[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: outlets.map(({ id, name, lon, lat }) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { id, name },
    })),
  };
}

function downloadGeoJSON(name: string, collection: FeatureCollection): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(collection, null, 2)], { type: "application/geo+json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name.replace(/[^\p{L}\p{N}._-]+/gu, "_") || "pour_points"}_出水口.geojson`;
  link.click();
  URL.revokeObjectURL(url);
}

function featureId(feature: FeatureCollection["features"][number]): number {
  return Number(feature.properties?.id ?? feature.properties?.VALUE);
}

function nameFeatures(
  collection: FeatureCollection,
  names: Map<number, string>,
): FeatureCollection {
  return {
    ...collection,
    features: collection.features.map((feature) => ({
      ...feature,
      properties: {
        ...(feature.properties ?? {}),
        name: names.get(featureId(feature)) ?? "未命名",
      },
    })),
  };
}

export function bindWatershedPlugin(
  map: MapLibreMap,
  fitLayer: (layer: GeoLibreLayer) => void,
  beforeArm?: () => void,
): WatershedPlugin {
  const baseUrl = `${import.meta.env.BASE_URL}api`;
  const button = document.createElement("button");
  const icon = document.createElement("img");
  button.type = "button";
  button.className = "icon-btn";
  button.dataset.tip = "流域快速提取";
  button.ariaLabel = "流域快速提取";
  button.ariaPressed = "false";
  icon.src = `${import.meta.env.BASE_URL}icons/watershed.svg`;
  icon.alt = "";
  button.append(icon);
  document.getElementById("identify")?.after(button);

  const panel = document.createElement("section");
  panel.className = "watershed-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="section-title"><strong>流域提取</strong><button type="button" data-close aria-label="关闭流域提取">×</button></div>
    <label class="field"><span>流域名称</span><input data-name value="流域 1" /></label>
    <label class="field watershed-snap"><span>重新提取</span><input data-reextract type="checkbox" title="替换同名流域及其出水口" /></label>
    <label class="field"><span>流向栅格</span><select data-flowdir aria-label="FlowDir"></select></label>
    <label class="field watershed-snap"><span>河道捕捉</span><input data-snap type="checkbox" /></label>
    <label class="field" data-flowaccu-row hidden><span>累积流栅格</span><select data-flowaccu aria-label="FlowAccum"></select></label>
    <label class="field" data-distance-row hidden><span>距离 (m)</span><input data-distance type="number" min="0" value="200" /></label>
    <div class="watershed-pick">
      <label><span>出水口名称</span><input data-outlet-name value="出水口 1" /></label>
      <button type="button" data-pick>地图选点</button>
    </div>
    <div class="watershed-points">
      <span>出水口 <small>勾选本次提取的点</small></span>
      <div class="watershed-point-list" data-point-list></div>
      <textarea data-points rows="2" placeholder="名称, 经度, 纬度；每行一个"></textarea>
      <button type="button" data-add-points>添加坐标</button>
    </div>
    <div class="watershed-actions"><button type="button" data-run>开始提取</button></div>`;
  document.querySelector("aside")?.append(panel);

  const flowdir = panel.querySelector<HTMLSelectElement>("[data-flowdir]")!;
  const flowaccu = panel.querySelector<HTMLSelectElement>("[data-flowaccu]")!;
  const snap = panel.querySelector<HTMLInputElement>("[data-snap]")!;
  const distance = panel.querySelector<HTMLInputElement>("[data-distance]")!;
  const resultName = panel.querySelector<HTMLInputElement>("[data-name]")!;
  const reextract = panel.querySelector<HTMLInputElement>("[data-reextract]")!;
  const outletName = panel.querySelector<HTMLInputElement>("[data-outlet-name]")!;
  const points = panel.querySelector<HTMLTextAreaElement>("[data-points]")!;
  const pointList = panel.querySelector<HTMLElement>("[data-point-list]")!;
  const addPoints = panel.querySelector<HTMLButtonElement>("[data-add-points]")!;
  const run = panel.querySelector<HTMLButtonElement>("[data-run]")!;
  const flowaccuRow = panel.querySelector<HTMLElement>("[data-flowaccu-row]")!;
  const distanceRow = panel.querySelector<HTMLElement>("[data-distance-row]")!;

  let armed = false;
  let loaded = false;
  let request: AbortController | null = null;
  let previousCursor = "";
  let previewMarker: Marker | null = null;
  let extractionIndex = 1;
  const draftMarkers = new Map<string, Marker>();
  const drafts: Array<
    NamedOutlet & { key: string; selected: boolean; extracted: boolean; areaKm2?: number }
  > = [];

  function setOptions(select: HTMLSelectElement, values: string[]): void {
    select.replaceChildren(...values.map((value) => new Option(value, value)));
    select.disabled = values.length === 0;
  }

  async function loadRasters(): Promise<void> {
    if (loaded) return;
    try {
      const rasters = await listWatershedRasters({ baseUrl });
      setOptions(flowdir, rasters.flowdirs);
      setOptions(flowaccu, rasters.flowaccus);
      loaded = true;
      if (!rasters.flowdirs.length) setStatus("数据目录中没有 FlowDir GeoTIFF", true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  }

  function renameAsset(key: string, name: string): void {
    const state = projectStore.getState();
    const layer = state.project.layers.find((item) => item.metadata.pourPointKey === key);
    if (!layer?.geojson) return;
    state.updateLayer(layer.id, {
      name,
      geojson: {
        ...layer.geojson,
        features: layer.geojson.features.map((feature) => ({
          ...feature,
          properties: { ...(feature.properties ?? {}), name },
        })),
      },
    });
  }

  function pointMarker(className: string): Marker {
    const point = document.createElement("div");
    point.className = className;
    return new Marker({ element: point });
  }

  function clearDraftMarkers(): void {
    for (const marker of draftMarkers.values()) marker.remove();
    draftMarkers.clear();
  }

  function syncDraftMarkers(): void {
    clearDraftMarkers();
    if (panel.hidden) return;
    for (const draft of drafts.filter(({ extracted }) => !extracted)) {
      draftMarkers.set(
        draft.key,
        pointMarker("watershed-map-point").setLngLat([draft.lon, draft.lat]).addTo(map),
      );
    }
  }

  function renderPoints(): void {
    syncDraftMarkers();
    if (!drafts.length) {
      const empty = document.createElement("small");
      empty.textContent = "尚未添加出水口";
      pointList.replaceChildren(empty);
      return;
    }
    pointList.replaceChildren(
      ...drafts.map((draft) => {
        const row = document.createElement("div");
        const selected = document.createElement("input");
        const name = document.createElement("input");
        const coordinates = document.createElement("small");
        const status = document.createElement("small");
        row.className = `watershed-point-row${draft.selected ? " selected" : ""}`;
        selected.type = "checkbox";
        selected.checked = draft.selected;
        selected.ariaLabel = `提取 ${draft.name}`;
        selected.title = draft.extracted ? "重新勾选可再次提取" : "参与本次提取";
        selected.addEventListener("change", () => {
          draft.selected = selected.checked;
          row.classList.toggle("selected", draft.selected);
        });
        name.value = draft.name;
        name.ariaLabel = "出水口名称";
        name.title = "点击修改名称";
        name.addEventListener("change", () => {
          const next = name.value.trim();
          if (!next || drafts.some((item) => item !== draft && item.name === next)) {
            name.value = draft.name;
            return setStatus("出水口名称不能为空或重复", true);
          }
          draft.name = next;
          selected.ariaLabel = `提取 ${next}`;
          renameAsset(draft.key, next);
        });
        coordinates.textContent = `${draft.lon.toFixed(3)}, ${draft.lat.toFixed(3)}`;
        status.textContent = draft.areaKm2
          ? `${draft.areaKm2.toLocaleString("zh-CN", { maximumFractionDigits: 1 })} km²`
          : draft.extracted
            ? "已提取"
            : "待提取";
        status.className = draft.extracted ? "done" : "";
        row.append(selected, name, coordinates, status);
        return row;
      }),
    );
  }

  function appendPoints(outlets: NamedOutlet[]): void {
    const names = new Set(drafts.map(({ name }) => name));
    if (outlets.some(({ name }) => names.has(name))) throw new Error("出水口名称不能重复");
    drafts.push(
      ...outlets.map((outlet) => ({
        ...outlet,
        key: crypto.randomUUID(),
        selected: true,
        extracted: false,
      })),
    );
    renderPoints();
  }

  function importPoints(): void {
    try {
      appendPoints(parsePourPoints(points.value));
      points.value = "";
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  }

  function disarm(): void {
    if (!armed) return;
    armed = false;
    map.off("click", pickAtClick);
    map.off("mousemove", previewAtMouse);
    previewMarker?.remove();
    previewMarker = null;
    map.getCanvas().style.cursor = previousCursor;
  }

  function closePanel(): void {
    disarm();
    clearDraftMarkers();
    panel.hidden = true;
    button.classList.remove("active");
    button.ariaPressed = "false";
  }

  function openPanel(): void {
    beforeArm?.();
    panel.hidden = false;
    button.classList.add("active");
    button.ariaPressed = "true";
    syncDraftMarkers();
    void loadRasters();
  }

  function previewAtMouse(event: MapMouseEvent): void {
    previewMarker ??= pointMarker("watershed-map-point preview").addTo(map);
    previewMarker.setLngLat(event.lngLat);
  }

  function pickAtClick(event: MapMouseEvent): void {
    disarm();
    const index = drafts.length + 1;
    const name = outletName.value.trim() || `出水口 ${index}`;
    try {
      appendPoints([
        { id: index, name, lon: event.lngLat.lng, lat: event.lngLat.lat },
      ]);
      outletName.value = `出水口 ${index + 1}`;
      setStatus(`已添加“${name}”`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  }

  function arm(): void {
    beforeArm?.();
    disarm();
    armed = true;
    previousCursor = map.getCanvas().style.cursor;
    map.getCanvas().style.cursor = "crosshair";
    map.on("mousemove", previewAtMouse);
    map.on("click", pickAtClick);
    setStatus("移动鼠标预览，单击地图添加出水口");
  }

  async function extract(): Promise<void> {
    disarm();
    try {
      const selectedDrafts = drafts.filter(({ selected }) => selected);
      if (!selectedDrafts.length) throw new Error("请选择本次要提取的出水口");
      const outlets = selectedDrafts.map(({ name, lon, lat }, index) => ({
        id: index + 1,
        name,
        lon,
        lat,
      }));
      const name = resultName.value.trim();
      if (!name) throw new Error("请输入流域名称");
      const existingLayers = projectStore
        .getState()
        .project.layers.filter((layer) => layer.metadata.watershedName === name);
      if (existingLayers.length && !reextract.checked) {
        throw new Error(`“${name}”已存在；如需替换，请勾选“重新提取”`);
      }
      if (!flowdir.value) throw new Error("请选择 FlowDir");
      const snapDistanceM = snap.checked ? Number(distance.value) : 0;
      if (!Number.isFinite(snapDistanceM) || snapDistanceM < 0) {
        throw new Error("捕捉距离必须是非负数");
      }
      if (snap.checked && !flowaccu.value) throw new Error("启用捕捉时必须选择 FlowAccum");

      request?.abort();
      const current = new AbortController();
      request = current;
      run.disabled = true;
      setStatus("正在提取流域…");
      const result = await createWatershedExtractor({
        baseUrl,
        flowdir: flowdir.value,
        flowaccu: snap.checked ? flowaccu.value : undefined,
        snapDistanceM,
      }).extract(outlets, current.signal);
      const watershed = result.watershed as FeatureCollection | null;
      const pointAssets = outletsToGeoJSON(outlets);
      const basinNames = new Map(
        outlets.map((outlet) => [
          outlet.id,
          outlets.length === 1 ? name : `${name} · ${outlet.name}`,
        ]),
      );
      const pointNames = new Map(outlets.map((outlet) => [outlet.id, outlet.name]));
      const state = projectStore.getState();
      const layers: GeoLibreLayer[] = [];
      if (watershed?.features.length) {
        const layer = createVectorLayer(name, nameFeatures(watershed, basinNames), state.project.layers);
        layer.metadata = { watershedName: name, watershedRole: "basin" };
        layers.push(layer);
      }
      for (const [index, outlet] of outlets.entries()) {
        const features = pointAssets.features.filter((feature) => featureId(feature) === outlet.id);
        const layer = createVectorLayer(
          outlet.name,
          nameFeatures({ ...pointAssets, features }, pointNames),
          [...state.project.layers, ...layers],
        );
        layer.metadata = {
          watershedName: name,
          watershedRole: "pour-point",
          pourPointKey: selectedDrafts[index]!.key,
          userAsset: true,
        };
        layers.push(layer);
      }
      const groupId =
        state.project.layerGroups?.find((group) => group.name === "流域提取结果")?.id ??
        state.addGroup("流域提取结果");
      for (const layer of existingLayers) state.removeLayer(layer.id);
      state.addLayers(layers);
      state.moveLayerToGroup(groupId, layers.map((layer) => layer.id));
      if (layers[0]) fitLayer(layers[0]);
      downloadGeoJSON(name, pointAssets);
      const area = result.response.basin_stats.reduce((sum, basin) => sum + basin.area_km2, 0);
      const areaText = area > 0 ? `（${area.toFixed(1)} km²）` : "";
      setStatus(
        `流域提取完成：${name}${areaText}；用时 ${formatElapsed(result.response.walls_ms)}；出水口 GeoJSON 已保存`,
      );
      for (const [index, draft] of selectedDrafts.entries()) {
        draft.extracted = true;
        draft.selected = false;
        draft.areaKm2 = result.response.basin_stats.find(({ id }) => id === index + 1)?.area_km2;
      }
      renderPoints();
      reextract.checked = false;
      extractionIndex += 1;
      resultName.value = `流域 ${extractionIndex}`;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setStatus(error instanceof Error ? error.message : String(error), true);
      }
    } finally {
      request = null;
      run.disabled = false;
    }
  }

  renderPoints();
  addPoints.addEventListener("click", importPoints);
  snap.addEventListener("change", () => {
    flowaccuRow.hidden = !snap.checked;
    distanceRow.hidden = !snap.checked;
  });
  panel.querySelector("[data-close]")?.addEventListener("click", closePanel);
  panel.querySelector("[data-pick]")?.addEventListener("click", arm);
  run.addEventListener("click", () => void extract());
  button.addEventListener("click", () => (panel.hidden ? openPanel() : closePanel()));

  return {
    cancel() {
      if (armed) {
        disarm();
        setStatus("已取消出水口拾取");
        return true;
      }
      if (request) {
        request.abort();
        request = null;
        setStatus("已取消流域提取");
        return true;
      }
      if (panel.hidden) return false;
      closePanel();
      return true;
    },
    dispose() {
      disarm();
      clearDraftMarkers();
      request?.abort();
      button.remove();
      panel.remove();
    },
  };
}
