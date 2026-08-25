import { applyGroupEffects, type GeoLibreProject, type MapViewState } from "@geolibre/core";
import { createLayerSync } from "@geolibre/map/headless";
import type * as maplibregl from "maplibre-gl";
import {
  applyBasemapOcclusion,
  basemapNativeIds,
  isBasemapLayer,
  occludedBasemapIds,
} from "./layer-order";
import { projectStore } from "./project-store";
import { isGeometryLayer } from "./geometry";
import { raiseGeometryLayers } from "./geometry-editor";
import { syncGeeRaster } from "@geolibre/plugins/earthengine";
import { isProjectRaster, type RasterAdapter } from "./raster";

/** Control already called map.setStyle; skip the renderer's second reload. */
let liveStyleUrl: string | undefined;

export function noteLiveStyle(url: string): void {
  liveStyleUrl = url;
}

export function createProjectRenderer(map: maplibregl.Map, raster: RasterAdapter): () => void {
  const layerSync = createLayerSync(map);
  let project = projectStore.getState().project;
  let projectId = project.id;
  let basemap = project.basemapStyleUrl;
  let pendingView: MapViewState | undefined;
  let suppressView = false;
  let allowRasterZoom = true;

  const paintBasemapVisibility = () => {
    if (!map.isStyleLoaded()) return;
    const current = projectStore.getState().project;
    const layers = applyGroupEffects(current.layers, current.layerGroups ?? []);
    const hidden = occludedBasemapIds(layers);
    for (const layer of layers) {
      if (!isBasemapLayer(layer)) continue;
      const show = layer.visible && !hidden.has(layer.id);
      const next = show ? "visible" : "none";
      for (const id of basemapNativeIds(layer)) {
        if (!map.getLayer(id)) continue;
        try {
          if (map.getLayoutProperty(id, "visibility") !== next) {
            map.setLayoutProperty(id, "visibility", next);
          }
        } catch {
          /* custom layers may reject layout */
        }
      }
    }
  };

  const syncLayers = () => {
    project = projectStore.getState().project;
    const layers = applyBasemapOcclusion(
      applyGroupEffects(project.layers, project.layerGroups ?? []),
    );
    if (map.getStyle()) {
      layerSync.sync(layers.filter((layer) => !isProjectRaster(layer) && !isGeometryLayer(layer)));
      if (map.isStyleLoaded()) paintBasemapVisibility();
    }
    raster.sync(project.layers, project.layerGroups ?? [], { zoomTo: allowRasterZoom });
    for (const layer of project.layers) syncGeeRaster(layer);
    raiseGeometryLayers();
    allowRasterZoom = true;
  };

  const applyProject = (opened: boolean) => {
    if (opened) allowRasterZoom = false;
    if (project.basemapStyleUrl !== basemap) {
      const url = project.basemapStyleUrl;
      const skip = liveStyleUrl === url;
      liveStyleUrl = undefined;
      basemap = url;
      if (!skip) {
        pendingView = opened ? project.mapView : undefined;
        map.setStyle(url, { diff: false });
        return;
      }
    }
    syncLayers();
  };

  const afterView = (then: () => void) => {
    requestAnimationFrame(() => {
      suppressView = false;
      then();
    });
  };

  const render = (next: GeoLibreProject) => {
    if (next === project) return;
    const opened = next.id !== projectId;
    project = next;
    if (opened) {
      projectId = next.id;
      suppressView = true;
      map.jumpTo(next.mapView);
      afterView(() => applyProject(true));
      return;
    }
    applyProject(false);
  };

  const onStyleLoad = () => {
    if (pendingView) {
      const view = pendingView;
      pendingView = undefined;
      suppressView = true;
      map.jumpTo(view);
      afterView(() => {
        allowRasterZoom = false;
        syncLayers();
      });
      return;
    }
    syncLayers();
  };

  const updateView = () => {
    if (suppressView) return;
    const center = map.getCenter();
    projectStore.getState().setMapView({
      center: [center.lng, center.lat],
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    });
  };

  map.on("style.load", onStyleLoad);
  map.on("moveend", updateView);
  map.on("zoomstart", paintBasemapVisibility);
  map.on("movestart", paintBasemapVisibility);
  const unsubscribe = projectStore.subscribe((state) => render(state.project));
  syncLayers();

  return () => {
    unsubscribe();
    map.off("style.load", onStyleLoad);
    map.off("moveend", updateView);
    map.off("zoomstart", paintBasemapVisibility);
    map.off("movestart", paintBasemapVisibility);
    layerSync.dispose();
    raster.dispose();
  };
}
