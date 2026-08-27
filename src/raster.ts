import {
  applyGroupEffects,
  DEFAULT_LAYER_STYLE,
  type GeoLibreLayer,
  type LayerGroup,
} from "@geolibre/core";
import { circleLayerId, fillLayerId, lineLayerId } from "@geolibre/map/headless";
import type * as maplibregl from "maplibre-gl";
import { RasterControl, type RasterLayerState } from "maplibre-gl-raster";
import { getRasterAsset, putRasterAsset } from "./assets";

export const PROJECT_RASTER_KIND = "project-raster";

/** Same rasterState fields GeoLibre's style panel pushes to the control. */
export function pickRasterState(value: unknown): Partial<RasterLayerState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const state: Partial<RasterLayerState> = {};
  if (raw.mode === "single" || raw.mode === "rgb" || raw.mode === "index") state.mode = raw.mode;
  if (typeof raw.index === "string" && raw.index) state.index = raw.index;
  if (
    Array.isArray(raw.bands) &&
    raw.bands.length > 0 &&
    raw.bands.every((band) => typeof band === "number" && Number.isInteger(band) && band > 0)
  ) {
    state.bands = raw.bands as number[];
  }
  if (
    raw.rescale === null ||
    (Array.isArray(raw.rescale) &&
      raw.rescale.length > 0 &&
      raw.rescale.every(
        (range) =>
          Array.isArray(range) &&
          range.length === 2 &&
          range.every((n) => typeof n === "number" && Number.isFinite(n)),
      ))
  ) {
    state.rescale = raw.rescale as [number, number][] | null;
  }
  if (typeof raw.colormap === "string" && raw.colormap) state.colormap = raw.colormap;
  if (typeof raw.reversed === "boolean") state.reversed = raw.reversed;
  if (
    raw.nodata === "off" ||
    raw.nodata === "auto" ||
    (typeof raw.nodata === "number" && Number.isFinite(raw.nodata))
  ) {
    state.nodata = raw.nodata;
  }
  if (typeof raw.gamma === "number" && Number.isFinite(raw.gamma) && raw.gamma > 0) {
    state.gamma = raw.gamma;
  }
  if (raw.stretch === "linear" || raw.stretch === "log" || raw.stretch === "sqrt") {
    state.stretch = raw.stretch;
  }
  return state;
}

export function transparentMinimum(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  if ((value as Record<string, unknown>).transparentBelowMin !== true) return;
  return pickRasterState(value).rescale?.[0]?.[0];
}

function rasterMetadata(layer: GeoLibreLayer): Partial<RasterLayerState> {
  return pickRasterState(layer.metadata.rasterState);
}

type RenderResult = {
  renderPipeline?: Array<{ module?: { name?: string }; props?: Record<string, unknown> }>;
};

type RasterManager = {
  _renderTileFor?: (layer: { id: string }) => (data: unknown) => RenderResult | null;
};

const MINIMUM_MASK = {
  name: "minimumMask",
  fs: "uniform minimumMaskUniforms { float value; } minimumMask;",
  inject: { "fs:DECKGL_FILTER_COLOR": "if (color.r < minimumMask.value) discard;" },
  uniformTypes: { value: "f32" },
  getUniforms: ({ value }: { value: number }) => ({ value }),
};

function installMinimumMask(control: RasterControl, thresholds: Map<string, number>): void {
  const manager = (control as unknown as { _layerManager?: RasterManager })._layerManager;
  if (!manager?._renderTileFor) return;
  const original = manager._renderTileFor.bind(manager);
  manager._renderTileFor = (layer) => {
    const render = original(layer);
    return (data) => {
      const result = render(data);
      const value = thresholds.get(layer.id);
      if (value === undefined || !result?.renderPipeline?.length) return result;
      const scale = Number((data as { sampleScale?: unknown }).sampleScale) || 1;
      return {
        ...result,
        renderPipeline: [
          result.renderPipeline[0]!,
          { module: MINIMUM_MASK, props: { value: value / scale } },
          ...result.renderPipeline.slice(1),
        ],
      };
    };
  };
}

export function isProjectRaster(layer: GeoLibreLayer): boolean {
  return layer.type === "cog" && layer.metadata.sourceKind === PROJECT_RASTER_KIND;
}

export function rasterAssetId(layer: GeoLibreLayer): string | null {
  return typeof layer.source.assetId === "string" ? layer.source.assetId : null;
}

function nativeLayerIds(layer: GeoLibreLayer): string[] {
  const external = layer.metadata.nativeLayerIds;
  if (Array.isArray(external)) return external.filter((id): id is string => typeof id === "string");
  if (layer.type !== "geojson") return [];
  return [fillLayerId(layer.id), lineLayerId(layer.id), circleLayerId(layer.id)];
}

export function rasterBeforeId(
  layers: GeoLibreLayer[],
  rasterId: string,
  exists: (id: string) => boolean,
): string | null {
  const index = layers.findIndex((layer) => layer.id === rasterId);
  for (const layer of layers.slice(index + 1)) {
    const id = nativeLayerIds(layer).find(exists);
    if (id) return id;
  }
  return null;
}

export function createRemoteRasterLayer(url: string): GeoLibreLayer {
  return {
    id: crypto.randomUUID(),
    name: url.split("/").pop()?.split("?")[0] || "Remote COG",
    type: "cog",
    source: { type: "raster", url },
    visible: true,
    opacity: 1,
    style: { ...DEFAULT_LAYER_STYLE },
    metadata: { sourceKind: PROJECT_RASTER_KIND, rasterState: { colormap: "viridis" } },
  };
}

export async function createLocalRasterLayer(file: File): Promise<GeoLibreLayer> {
  const id = crypto.randomUUID();
  await putRasterAsset(id, file);
  return {
    id,
    name: file.name,
    type: "cog",
    source: { type: "raster", assetId: id },
    visible: true,
    opacity: 1,
    style: { ...DEFAULT_LAYER_STYLE },
    metadata: {
      sourceKind: PROJECT_RASTER_KIND,
      localFileName: file.name,
      rasterState: { colormap: "viridis" },
    },
  };
}

async function sourceFor(layer: GeoLibreLayer): Promise<File | string> {
  if (typeof layer.source.url === "string" && layer.source.url) return layer.source.url;
  const assetId = rasterAssetId(layer);
  const file = assetId ? await getRasterAsset(assetId) : null;
  if (!file) throw new Error(`本地栅格资产不可用：${layer.name}`);
  return file;
}

function sourceKey(layer: GeoLibreLayer): string {
  return typeof layer.source.url === "string"
    ? `url:${layer.source.url}`
    : `asset:${rasterAssetId(layer) ?? ""}`;
}

export interface RasterAdapter {
  sync(layers: GeoLibreLayer[], groups: LayerGroup[], opts?: { zoomTo?: boolean }): void;
  zoomTo(id: string): void;
  selectRaster(id: string | null): void;
  setInspect(enabled: boolean): void;
  collapse(): void;
  collapsed(): boolean;
  dispose(): void;
}

export function createRasterAdapter(
  map: maplibregl.Map,
  onError: (message: string) => void,
): RasterAdapter {
  const control = new RasterControl({ collapsed: true });
  map.addControl(control, "top-right");
  const loading = new Map<string, string>();
  const loadedKeys = new Map<string, string>();
  const thresholds = new Map<string, number>();
  installMinimumMask(control, thresholds);
  let desired = new Map<string, GeoLibreLayer>();
  let anchors = new Map<string, string | null>();
  let disposed = false;

  const applyState = (layer: GeoLibreLayer) => {
    if (!control.getRaster(layer.id)) return;
    control.setRasterState(layer.id, {
      ...rasterMetadata(layer),
      opacity: layer.opacity,
      visible: layer.visible,
    });
    control.setRasterBeforeId(layer.id, anchors.get(layer.id) ?? null);
  };

  const ensure = async (layer: GeoLibreLayer, zoomTo: boolean) => {
    const key = sourceKey(layer);
    if (control.getRaster(layer.id)) {
      if (loadedKeys.get(layer.id) === key) return applyState(layer);
      control.removeRaster(layer.id);
      loadedKeys.delete(layer.id);
    }
    if (loading.get(layer.id) === key) return;
    loading.set(layer.id, key);
    try {
      await control.addRaster(await sourceFor(layer), {
        id: layer.id,
        name: layer.name,
        zoomTo: zoomTo && layer.metadata.zoomTo === true,
        beforeId: anchors.get(layer.id) ?? undefined,
        state: {
          ...rasterMetadata(layer),
          opacity: layer.opacity,
          visible: layer.visible,
        },
      });
      if (disposed || sourceKey(desired.get(layer.id) ?? layer) !== key || !desired.has(layer.id)) {
        control.removeRaster(layer.id);
        return;
      }
      loadedKeys.set(layer.id, key);
      applyState(desired.get(layer.id)!);
      [...desired.keys()].forEach((id, index) => {
        if (control.getRaster(id)) control.reorderRaster(id, index);
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      if (loading.get(layer.id) === key) loading.delete(layer.id);
    }
  };

  return {
    sync(layers, groups, opts) {
      const zoomTo = opts?.zoomTo !== false;
      const ordered = applyGroupEffects(layers, groups);
      const rasters = ordered.filter(isProjectRaster);
      desired = new Map(rasters.map((layer) => [layer.id, layer]));
      anchors = new Map(
        rasters.map((layer) => [
          layer.id,
          rasterBeforeId(ordered, layer.id, (id) => Boolean(map.getLayer(id))),
        ]),
      );
      thresholds.clear();
      for (const layer of rasters) {
        const min = transparentMinimum(layer.metadata.rasterState);
        if (min !== undefined) thresholds.set(layer.id, min);
      }
      for (const raster of control.getRasters()) {
        if (!desired.has(raster.id)) {
          control.removeRaster(raster.id);
          loadedKeys.delete(raster.id);
        }
      }
      for (const layer of rasters) void ensure(layer, zoomTo);
      rasters.forEach((layer, index) => {
        if (control.getRaster(layer.id)) control.reorderRaster(layer.id, index);
      });
    },
    zoomTo(id) {
      control.zoomToRaster(id);
    },
    selectRaster(id) {
      control.selectRaster(id);
    },
    setInspect(enabled) {
      control.setInspect(enabled);
    },
    collapse() {
      control.collapse();
    },
    collapsed() {
      return control.getState().collapsed;
    },
    dispose() {
      disposed = true;
      desired.clear();
      if (map.hasControl(control)) map.removeControl(control);
    },
  };
}
