import { DEFAULT_LAYER_STYLE, type GeoLibreLayer } from "@geolibre/core";
import type { Map as MapLibreMap } from "maplibre-gl";
import { BasemapControl } from "maplibre-gl-basemap-control";
import { installBasemapThumbnails } from "@geolibre/plugins/basemap-thumbnails";
import { basemapInsertIndex } from "./layer-order";
import { noteLiveStyle } from "./project-renderer";
import { projectStore } from "./project-store";

function dropBasemapLayers(keepId?: string): void {
  for (const layer of projectStore.getState().project.layers) {
    if (layer.metadata.sourceKind !== "maplibre-basemap-control") continue;
    if (keepId && layer.metadata.basemapId === keepId) continue;
    projectStore.getState().removeLayer(layer.id);
  }
}

function commitBasemapLayer(layer: GeoLibreLayer): void {
  const store = projectStore.getState();
  if (store.project.layers.some((item) => item.metadata.basemapId === layer.metadata.basemapId)) return;
  store.addLayer(layer);
  store.moveLayer(layer.id, basemapInsertIndex(store.project.layers, layer.id));
}

export function bindBasemaps(
  map: MapLibreMap,
  setStatus: (message: string, error?: boolean) => void,
): BasemapControl {
  const control = new BasemapControl({
    collapsed: true,
    title: "Basemaps",
    allowMultiple: true,
    confirmStyleReplace: ({ basemap, replacedBasemapIds }) => {
      const count = replacedBasemapIds.length;
      if (count === 0) return true;
      return confirm(
        count === 1
          ? `切换到「${basemap.name}」会移除已叠加的底图，是否继续？`
          : `切换到「${basemap.name}」会移除已叠加的 ${count} 个底图，是否继续？`,
      );
    },
  });
  let thumbs!: ReturnType<typeof installBasemapThumbnails>;
  control.on("basemapchange", (event) => {
    if (event.type !== "basemapchange") return;
    const { source } = event.basemap;
    if (source.type === "style" || source.type === "vector-style") {
      dropBasemapLayers();
      const url = event.resolvedStyleUrl ?? source.url;
      thumbs.pause();
      noteLiveStyle(url);
      projectStore.getState().setBasemapStyleUrl(url);
      return;
    }
    if (source.type !== "raster" || !event.managedRaster) return;
    if (event.mode !== "add") dropBasemapLayers(event.basemap.id);
    commitBasemapLayer({
      id: `basemap-${event.basemap.id}`,
      name: event.basemap.name,
      type: "raster",
      source: {
        type: "raster",
        tiles: source.tiles,
        tileSize: source.tileSize ?? 256,
        attribution: event.basemap.attribution,
      },
      visible: true,
      opacity: 1,
      style: { ...DEFAULT_LAYER_STYLE },
      metadata: {
        sourceKind: "maplibre-basemap-control",
        externalNativeLayer: true,
        nativeLayerIds: [event.managedRaster.layerId],
        sourceId: event.managedRaster.sourceId,
        sourceIds: [event.managedRaster.sourceId],
        basemapId: event.basemap.id,
      },
    });
  });
  control.on("basemapremove", (event) => {
    if (event.type !== "basemapremove") return;
    const layer = projectStore.getState().project.layers.find(
      (item) => item.metadata.basemapId === event.basemap.id,
    );
    if (layer) projectStore.getState().removeLayer(layer.id);
  });
  control.on("error", (event) => {
    if (event.type === "error" && event.error) setStatus(event.error.message, true);
  });
  map.addControl(control, "top-left");
  thumbs = installBasemapThumbnails(control);
  Map.addBasemap = async (ids, group) => {
    const requested = typeof ids === "string" ? [ids] : ids;
    for (const id of requested) {
      if (!control.isBasemapActive(id)) await control.addBasemap(id);
    }
    if (!group) return;
    const store = projectStore.getState();
    const layerIds = store.project.layers
      .filter((layer) => requested.includes(String(layer.metadata.basemapId)))
      .map((layer) => layer.id);
    if (layerIds.length) store.moveLayerToGroup(group, layerIds);
  };
  return control;
}

declare global {
  interface MapConstructor {
    addBasemap(ids: string | readonly string[], group?: string): Promise<void>;
  }
}
