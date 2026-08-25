import { createWatershedExtractor } from "@spatialhydro/watershed";
import type { GeoLibreLayer } from "@geolibre/core";
import type { FeatureCollection } from "geojson";
import type { Map, MapMouseEvent } from "maplibre-gl";
import { setStatus } from "../../src/dom";
import { projectStore } from "../../src/project-store";
import { createVectorLayer } from "../../src/vector";

export interface WatershedPlugin {
  cancel(): boolean;
  dispose(): void;
}

export function bindWatershedPlugin(
  map: Map,
  fitLayer: (layer: GeoLibreLayer) => void,
  beforeArm?: () => void,
): WatershedPlugin {
  const extractor = createWatershedExtractor({ baseUrl: `${import.meta.env.BASE_URL}api` });
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
  document.querySelector(".toolbar")?.append(button);

  let armed = false;
  let request: AbortController | null = null;
  let previousCursor = "";

  function disarm(): void {
    if (!armed) return;
    armed = false;
    map.off("click", extractAtClick);
    map.getCanvas().style.cursor = previousCursor;
    button.classList.remove("active");
    button.ariaPressed = "false";
  }

  function arm(): void {
    beforeArm?.();
    armed = true;
    previousCursor = map.getCanvas().style.cursor;
    map.getCanvas().style.cursor = "crosshair";
    button.classList.add("active");
    button.ariaPressed = "true";
    map.on("click", extractAtClick);
    setStatus("单击地图选择流域出水口");
  }

  async function extractAtClick(event: MapMouseEvent): Promise<void> {
    disarm();
    request?.abort();
    const current = new AbortController();
    request = current;
    setStatus("正在提取流域…");
    try {
      const result = await extractor.extract(
        { lon: event.lngLat.lng, lat: event.lngLat.lat },
        current.signal,
      );
      const watershed = result.watershed as FeatureCollection;
      const pourPoints = result.pourPoints as FeatureCollection;
      const geojson: FeatureCollection = {
        type: "FeatureCollection",
        features: [...watershed.features, ...pourPoints.features],
      };
      const area = result.response.basin_stats[0]?.area_km2;
      const name = area == null ? "提取流域" : `提取流域 ${area.toFixed(1)} km²`;
      const state = projectStore.getState();
      const layer = createVectorLayer(name, geojson, state.project.layers);
      state.addLayer(layer);
      fitLayer(layer);
      setStatus(`${name} · ${result.response.walls_ms} ms`);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setStatus(error instanceof Error ? error.message : String(error), true);
      }
    } finally {
      if (request === current) request = null;
    }
  }

  button.addEventListener("click", () => (armed ? disarm() : arm()));

  return {
    cancel() {
      if (armed) {
        disarm();
        setStatus("已取消流域提取");
        return true;
      }
      if (!request) return false;
      request.abort();
      request = null;
      setStatus("已取消流域提取");
      return true;
    },
    dispose() {
      disarm();
      request?.abort();
      button.remove();
    },
  };
}
