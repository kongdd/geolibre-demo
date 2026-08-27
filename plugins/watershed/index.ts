import { createWatershedExtractor, type Outlet } from "./client";
import type { GeoLibreLayer } from "@geolibre/core";
import type { FeatureCollection } from "geojson";
import { Marker, type Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import { setStatus } from "geolibre-lite/dom";
import { projectStore } from "geolibre-lite/project/store";
import { createVectorLayer } from "geolibre-lite/vector";

export interface WatershedPlugin {
  cancel(): boolean;
  close(): void;
  dispose(): void;
}

export function formatElapsed(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export function formatArea(areaKm2?: number): string {
  return typeof areaKm2 === "number" && Number.isFinite(areaKm2)
    ? `${Math.round(areaKm2).toLocaleString("zh-CN")} km²`
    : "— km²";
}

export interface WatershedRasterOption {
  id: string;
  name: string;
  value: string;
}

export function watershedRasterOptions(layers: GeoLibreLayer[]): WatershedRasterOption[] {
  return layers.flatMap((layer) => {
    if (layer.type !== "cog") return [];
    const raw =
      typeof layer.source.url === "string"
        ? layer.source.url
        : typeof layer.metadata.localFileName === "string"
          ? layer.metadata.localFileName
          : "";
    if (!raw) return [];
    const file = raw.split("?")[0]!.split("/").pop() || "";
    let value = file;
    try {
      value = decodeURIComponent(file);
    } catch {
      /* keep malformed user-supplied filename verbatim */
    }
    return value ? [{ id: layer.id, name: layer.name, value }] : [];
  });
}

export interface NamedOutlet extends Outlet {
  id: number;
  name: string;
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

export type WatershedDraft = NamedOutlet & {
  key: string;
  selected: boolean;
  extracted: boolean;
  areaKm2?: number;
};

export function draftsFromLayers(layers: GeoLibreLayer[]): WatershedDraft[] {
  const drafts: WatershedDraft[] = [];
  for (const layer of layers) {
    if (layer.metadata.watershedRole !== "pour-point") continue;
    const feature = layer.geojson?.features.find((item) => item.geometry?.type === "Point");
    if (!feature || feature.geometry.type !== "Point") continue;
    const [lon, lat] = feature.geometry.coordinates;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const rawId = Number(feature.properties?.id);
    const id = Number.isSafeInteger(rawId) && rawId > 0 ? rawId : drafts.length + 1;
    const name =
      (typeof feature.properties?.name === "string" && feature.properties.name) ||
      layer.name.match(/^Pour_(.+)$/)?.[1] ||
      `站点${id}`;
    const areaKm2 = Number(layer.metadata.watershedAreaKm2);
    drafts.push({
      id,
      name,
      lon,
      lat,
      key: typeof layer.metadata.pourPointKey === "string" ? layer.metadata.pourPointKey : layer.id,
      selected: false,
      extracted: true,
      ...(Number.isFinite(areaKm2) ? { areaKm2 } : {}),
    });
  }
  return drafts;
}

function featureId(feature: FeatureCollection["features"][number]): number {
  return Number(feature.properties?.id ?? feature.properties?.VALUE);
}

export interface WatershedDeletion {
  name: string;
  removeLayerIds: string[];
  basinUpdates: Array<{ id: string; geojson: FeatureCollection }>;
}

export function watershedDeletion(
  layers: GeoLibreLayer[],
  key: string,
): WatershedDeletion | null {
  const pour = layers.find((layer) => layer.metadata.pourPointKey === key);
  if (!pour) return null;
  const rawName = pour.metadata.watershedName;
  const name = typeof rawName === "string" ? rawName : pour.name;
  const outlet = pour.geojson?.features.find((feature) => feature.geometry?.type === "Point");
  const outletId = outlet ? featureId(outlet) : NaN;
  const removeLayerIds = [pour.id];
  const basinUpdates: WatershedDeletion["basinUpdates"] = [];

  if (typeof rawName === "string" && Number.isFinite(outletId)) {
    for (const layer of layers) {
      if (layer.metadata.watershedRole !== "basin" || layer.metadata.watershedName !== rawName) {
        continue;
      }
      const geojson = layer.geojson;
      if (!geojson) continue;
      const features = geojson.features.filter((feature) => featureId(feature) !== outletId);
      if (features.length === geojson.features.length) continue;
      if (features.length) basinUpdates.push({ id: layer.id, geojson: { ...geojson, features } });
      else removeLayerIds.push(layer.id);
    }
  }
  return { name, removeLayerIds, basinUpdates };
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
    <button type="button" class="watershed-resizer" data-resize aria-label="调整流域提取窗口高度" title="向上拖动扩大窗口"></button>
    <div class="section-title"><strong>流域提取</strong><button type="button" data-close aria-label="关闭流域提取">×</button></div>
    <label class="field watershed-snap"><span>重新提取</span><input data-reextract type="checkbox" title="替换所选站点已有的流域及出水口" /></label>
    <label class="field"><span>流向栅格</span><select data-flowdir aria-label="FlowDir"></select></label>
    <label class="field watershed-snap"><span>河道捕捉</span><input data-snap type="checkbox" /></label>
    <label class="field" data-flowaccu-row hidden><span>累积流栅格</span><select data-flowaccu aria-label="FlowAccum"></select></label>
    <label class="field" data-distance-row hidden><span>距离 (m)</span><input data-distance type="number" min="0" value="200" /></label>
    <div class="watershed-pick">
      <label><span>站点</span><input data-outlet-name value="站点1" /></label>
      <button type="button" data-pick>地图选点</button>
    </div>
    <div class="watershed-actions"><button type="button" data-run>开始提取</button></div>
    <div class="watershed-point-list" data-point-list></div>`;
  document.querySelector("aside")?.append(panel);

  const resizeHandle = panel.querySelector<HTMLButtonElement>("[data-resize]")!;
  const flowdir = panel.querySelector<HTMLSelectElement>("[data-flowdir]")!;
  const flowaccu = panel.querySelector<HTMLSelectElement>("[data-flowaccu]")!;
  const snap = panel.querySelector<HTMLInputElement>("[data-snap]")!;
  const distance = panel.querySelector<HTMLInputElement>("[data-distance]")!;
  const reextract = panel.querySelector<HTMLInputElement>("[data-reextract]")!;
  const outletName = panel.querySelector<HTMLInputElement>("[data-outlet-name]")!;
  const pointList = panel.querySelector<HTMLElement>("[data-point-list]")!;
  const run = panel.querySelector<HTMLButtonElement>("[data-run]")!;
  const flowaccuRow = panel.querySelector<HTMLElement>("[data-flowaccu-row]")!;
  const distanceRow = panel.querySelector<HTMLElement>("[data-distance-row]")!;

  let armed = false;
  let rasterLayers: GeoLibreLayer[] | undefined;
  let request: AbortController | null = null;
  let previousCursor = "";
  let previewMarker: Marker | null = null;
  const draftMarkers = new Map<string, Marker>();
  const drafts: WatershedDraft[] = [];
  let projectId = projectStore.getState().project.id;
  let pourSignature = "";
  let minimumPanelHeight = 0;

  function resizePanel(height: number): void {
    minimumPanelHeight ||= panel.getBoundingClientRect().height;
    const available = (panel.parentElement?.clientHeight ?? innerHeight) - 128;
    panel.style.height = `${Math.max(minimumPanelHeight, Math.min(height, available))}px`;
    panel.classList.add("resized");
  }

  resizeHandle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = panel.getBoundingClientRect().height;
    resizeHandle.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => resizePanel(startHeight + startY - next.clientY);
    const stop = () => {
      resizeHandle.removeEventListener("pointermove", move);
      resizeHandle.removeEventListener("pointerup", stop);
      resizeHandle.removeEventListener("pointercancel", stop);
    };
    resizeHandle.addEventListener("pointermove", move);
    resizeHandle.addEventListener("pointerup", stop);
    resizeHandle.addEventListener("pointercancel", stop);
  });
  resizeHandle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    resizePanel(panel.getBoundingClientRect().height + (event.key === "ArrowUp" ? 32 : -32));
  });

  function setOptions(
    select: HTMLSelectElement,
    options: WatershedRasterOption[],
    preferred: RegExp,
  ): void {
    const previous = select.value;
    select.replaceChildren(...options.map(({ id, name }) => new Option(name, id)));
    select.value = options.some(({ id }) => id === previous)
      ? previous
      : (options.find(({ name }) => preferred.test(name)) ?? options[0])?.id ?? "";
    select.disabled = options.length === 0;
  }

  function refreshRasters(): void {
    const layers = projectStore.getState().project.layers;
    if (layers === rasterLayers) return;
    rasterLayers = layers;
    const options = watershedRasterOptions(layers);
    setOptions(flowdir, options, /流向|flow.?dir/i);
    setOptions(flowaccu, options, /累积流|flow.?acc/i);
  }

  function selectedRaster(select: HTMLSelectElement): string {
    return watershedRasterOptions(projectStore.getState().project.layers).find(
      ({ id }) => id === select.value,
    )?.value ?? "";
  }

  function renameAsset(key: string, name: string): void {
    const state = projectStore.getState();
    for (const layer of state.project.layers.filter(
      (item) => item.metadata.pourPointKey === key,
    )) {
      if (!layer.geojson) continue;
      const prefix = layer.metadata.watershedRole === "basin" ? "Basin" : "Pour";
      state.updateLayer(layer.id, {
        name: `${prefix}_${name}`,
        metadata: { ...layer.metadata, watershedName: name },
        geojson: {
          ...layer.geojson,
          features: layer.geojson.features.map((feature) => ({
            ...feature,
            properties: { ...(feature.properties ?? {}), name, watershedName: name },
          })),
        },
      });
    }
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
      ...[...drafts].reverse().map((draft) => {
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
        coordinates.className = "coordinates";
        coordinates.textContent = `${draft.lon.toFixed(3)}, ${draft.lat.toFixed(3)}`;
        status.textContent = draft.extracted ? formatArea(draft.areaKm2) : "待提取";
        status.className = `status${draft.extracted ? " done" : ""}`;
        row.append(selected, name, coordinates, status);
        if (draft.extracted) {
          const deleteButton = document.createElement("button");
          deleteButton.type = "button";
          deleteButton.className = "watershed-point-delete";
          deleteButton.textContent = "删除";
          deleteButton.ariaLabel = `删除流域 ${draft.name}`;
          deleteButton.addEventListener("click", () => {
            const state = projectStore.getState();
            const deletion = watershedDeletion(state.project.layers, draft.key);
            if (!deletion || !confirm(`删除流域“${deletion.name}”？`)) return;
            for (const { id, geojson } of deletion.basinUpdates) state.updateLayer(id, { geojson });
            for (const id of deletion.removeLayerIds) state.removeLayer(id);
            setStatus(`已删除流域“${deletion.name}”`);
          });
          row.append(deleteButton);
        }
        return row;
      }),
    );
  }

  function pourKeys(layers: GeoLibreLayer[]): string {
    return layers
      .filter((layer) => layer.metadata.watershedRole === "pour-point")
      .map((layer) => `${layer.id}:${String(layer.metadata.pourPointKey ?? "")}`)
      .join("|");
  }

  function syncDraftsFromProject(): void {
    const project = projectStore.getState().project;
    const next = `${project.id}\n${pourKeys(project.layers)}`;
    if (next === pourSignature) return;
    const sameProject = project.id === projectId;
    const areas = new Map(
      drafts.filter((draft) => draft.areaKm2 != null).map((draft) => [draft.key, draft.areaKm2]),
    );
    const unextracted = sameProject ? drafts.filter((draft) => !draft.extracted) : [];
    pourSignature = next;
    projectId = project.id;
    const restored = draftsFromLayers(project.layers).map((draft) =>
      areas.has(draft.key) ? { ...draft, areaKm2: areas.get(draft.key) } : draft,
    );
    const keys = new Set(restored.map((draft) => draft.key));
    drafts.length = 0;
    drafts.push(...restored, ...unextracted.filter((draft) => !keys.has(draft.key)));
    outletName.value = `站点${drafts.length + 1}`;
    renderPoints();
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
    refreshRasters();
  }

  function previewAtMouse(event: MapMouseEvent): void {
    if (previewMarker) previewMarker.setLngLat(event.lngLat);
    else previewMarker = pointMarker("watershed-map-point preview").setLngLat(event.lngLat).addTo(map);
  }

  function pickAtClick(event: MapMouseEvent): void {
    disarm();
    const index = drafts.length + 1;
    const name = outletName.value.trim() || `站点${index}`;
    try {
      appendPoints([
        { id: index, name, lon: event.lngLat.lng, lat: event.lngLat.lat },
      ]);
      outletName.value = `站点${index + 1}`;
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
      const selectedKeys = new Set(selectedDrafts.map(({ key }) => key));
      const existingLayers = projectStore
        .getState()
        .project.layers.filter(
          (layer) =>
            typeof layer.metadata.pourPointKey === "string" &&
            selectedKeys.has(layer.metadata.pourPointKey),
        );
      if (existingLayers.length && !reextract.checked) {
        throw new Error("所选站点已有流域；如需替换，请勾选“重新提取”");
      }
      const flowdirValue = selectedRaster(flowdir);
      const flowaccuValue = selectedRaster(flowaccu);
      if (!flowdirValue) throw new Error("请选择 FlowDir 图层");
      const snapDistanceM = snap.checked ? Number(distance.value) : 0;
      if (!Number.isFinite(snapDistanceM) || snapDistanceM < 0) {
        throw new Error("捕捉距离必须是非负数");
      }
      if (snap.checked && !flowaccuValue) throw new Error("启用捕捉时必须选择 FlowAccum 图层");

      request?.abort();
      const current = new AbortController();
      request = current;
      run.disabled = true;
      setStatus("正在提取流域…");
      const result = await createWatershedExtractor({
        baseUrl,
        flowdir: flowdirValue,
        flowaccu: snap.checked ? flowaccuValue : undefined,
        snapDistanceM,
      }).extract(outlets, current.signal);
      const watershed = result.watershed as FeatureCollection | null;
      const pointAssets = outletsToGeoJSON(outlets);
      const pointNames = new Map(outlets.map((outlet) => [outlet.id, outlet.name]));
      const basinAreas = new Map(
        result.response.basin_stats.map(({ id, area_km2 }) => [id, area_km2]),
      );
      const state = projectStore.getState();
      const layers: GeoLibreLayer[] = [];
      const basinGroupId =
        state.project.layerGroups?.find((group) => group.name === "Basins")?.id ??
        state.addGroup("Basins");
      const pourGroupId =
        projectStore.getState().project.layerGroups?.find((group) => group.name === "Pours")?.id ??
        projectStore.getState().addGroup("Pours");
      if (watershed?.features.length) {
        for (const [index, outlet] of outlets.entries()) {
          const features = watershed.features.filter((feature) => featureId(feature) === outlet.id);
          if (!features.length) continue;
          const collection = nameFeatures(
            { ...watershed, features },
            new Map([[outlet.id, outlet.name]]),
          );
          collection.features = collection.features.map((feature) => ({
            ...feature,
            properties: {
              ...(feature.properties ?? {}),
              watershedName: outlet.name,
              area_km2: basinAreas.get(outlet.id),
            },
          }));
          const layer = createVectorLayer(
            `Basin_${outlet.name}`,
            collection,
            [...state.project.layers, ...layers],
          );
          layer.groupId = basinGroupId;
          layer.metadata = {
            watershedName: outlet.name,
            watershedRole: "basin",
            pourPointKey: selectedDrafts[index]!.key,
            watershedAreaKm2: basinAreas.get(outlet.id),
          };
          layers.push(layer);
        }
      }
      for (const [index, outlet] of outlets.entries()) {
        const key = selectedDrafts[index]!.key;
        const features = pointAssets.features
          .filter((feature) => featureId(feature) === outlet.id)
          .map((feature) => ({
            ...feature,
            properties: {
              ...(feature.properties ?? {}),
              watershedName: outlet.name,
              pourPointKey: key,
              area_km2: basinAreas.get(outlet.id),
            },
          }));
        const layer = createVectorLayer(
          `Pour_${outlet.name}`,
          nameFeatures({ ...pointAssets, features }, pointNames),
          [...state.project.layers, ...layers],
        );
        layer.groupId = pourGroupId;
        layer.metadata = {
          watershedName: outlet.name,
          watershedRole: "pour-point",
          pourPointKey: key,
          watershedAreaKm2: basinAreas.get(outlet.id),
          userAsset: true,
        };
        layers.push(layer);
      }
      for (const layer of existingLayers) state.removeLayer(layer.id);
      state.addLayers(layers);
      if (layers[0]) fitLayer(layers[0]);
      const area = result.response.basin_stats.reduce((sum, basin) => sum + basin.area_km2, 0);
      const areaText = area > 0 ? `（${area.toFixed(1)} km²）` : "";
      setStatus(
        `流域提取完成：${outlets.map(({ name }) => name).join("、")}${areaText}；用时 ${formatElapsed(result.response.walls_ms)}`,
      );
      for (const [index, draft] of selectedDrafts.entries()) {
        draft.extracted = true;
        draft.selected = false;
        draft.areaKm2 = basinAreas.get(outlets[index]!.id);
      }
      renderPoints();
      reextract.checked = false;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setStatus(error instanceof Error ? error.message : String(error), true);
      }
    } finally {
      request = null;
      run.disabled = false;
    }
  }

  refreshRasters();
  syncDraftsFromProject();
  const unsubscribe = projectStore.subscribe(() => {
    refreshRasters();
    syncDraftsFromProject();
  });
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
    close() {
      if (!panel.hidden) closePanel();
    },
    dispose() {
      disarm();
      clearDraftMarkers();
      request?.abort();
      unsubscribe();
      button.remove();
      panel.remove();
    },
  };
}
