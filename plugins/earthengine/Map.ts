import { DEFAULT_LAYER_STYLE, type GeoLibreLayer, type LayerStyle } from "@geolibre/core";
import type { ImageCollection } from "@google/earthengine";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import {
  createGeometryLayer,
  isGeometryLayer,
  lineFeature,
  nextGeometryColor,
  nextGeometryName,
  pointFeature,
  polygonFeature,
  rectangleRing,
} from "../../src/geometry";
import { projectStore } from "../../src/project-store";
import {
  ee,
  encodeExpression,
  getMapResult,
  isEe,
  isLocalImageSrc,
  isLocalVectorSrc,
  isOfficialEe,
  officialEe,
  runEe,
  tilesFromMapId,
  viewBounds,
} from "./ee";
import { annualEt } from "./PMLV2";
import { PENDING_EE_TILES } from "./run";
import { createLocalRasterLayer, createRemoteRasterLayer } from "../../src/raster";
import { createVectorLayer, readVectorFile } from "../../src/vector";

export type AddKind = "geojson" | "xyz" | "cog";
export type AddSrc = string | File | FeatureCollection | Feature | Geometry | ee.Object | ee.Computed;

export type AddOpts = {
  type?: AddKind;
  name?: string;
  color?: string;
  fill?: string;
  stroke?: string;
  width?: number;
  opacity?: number;
  visible?: boolean;
  colormap?: string;
  rescale?: [number, number][];
  stretch?: "linear" | "log" | "sqrt";
  transparentBelowMin?: boolean;
  bands?: Array<string | number>;
  group?: string;
  zoom?: boolean;
  attribution?: string;
};

/** GEE `visParams`：矢量 `color`/`fillColor`/`width`；栅格 `min`/`max`/`palette`。 */
export type VisParams = {
  color?: string;
  fillColor?: string;
  fill?: string;
  stroke?: string;
  width?: number;
  palette?: string | string[];
  colormap?: string;
  min?: number;
  max?: number;
  bands?: Array<string | number>;
  stretch?: "linear" | "log" | "sqrt";
  transparentBelowMin?: boolean;
  opacity?: number;
  composite?: "yearSum";
  year?: number;
  scale?: number;
};

export function sniff(src: AddSrc, hint?: AddKind): AddKind {
  if (hint) return hint;
  if (typeof src === "string") {
    if (/\{[xyz]\}/i.test(src)) return "xyz";
    if (/\.(tif|tiff|cog)(\?|#|$)/i.test(src)) return "cog";
    return "geojson";
  }
  if (typeof File !== "undefined" && src instanceof File) {
    return /\.(tif|tiff)$/i.test(src.name) ? "cog" : "geojson";
  }
  return "geojson";
}

export function asCollection(value: unknown): FeatureCollection {
  if (!value || typeof value !== "object") throw new Error("不是 GeoJSON");
  const type = (value as { type?: unknown }).type;
  if (type === "FeatureCollection" && Array.isArray((value as FeatureCollection).features)) {
    return value as FeatureCollection;
  }
  if (type === "Feature") return { type: "FeatureCollection", features: [value as Feature] };
  if (typeof type === "string" && "coordinates" in value) {
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: value as Geometry }],
    };
  }
  throw new Error("不是 GeoJSON");
}

function fileName(src: string, fallback: string): string {
  try {
    return decodeURIComponent(new URL(src).pathname).split("/").pop() || fallback;
  } catch {
    return src.split("/").pop()?.split("?")[0] || fallback;
  }
}

function fillFrom(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}40` : color;
}

function applyOpts(layer: GeoLibreLayer, opts: AddOpts): GeoLibreLayer {
  if (opts.name) layer.name = opts.name;
  if (opts.group) layer.groupId = opts.group;
  if (opts.opacity !== undefined) layer.opacity = opts.opacity;
  if (opts.visible !== undefined) layer.visible = opts.visible;
  const style: LayerStyle = { ...layer.style };
  if (opts.color) {
    style.strokeColor = opts.color;
    style.fillColor = opts.fill ?? fillFrom(opts.color);
  }
  if (opts.fill) style.fillColor = opts.fill;
  if (opts.stroke) style.strokeColor = opts.stroke;
  if (opts.width !== undefined) style.strokeWidth = opts.width;
  layer.style = style;
  if (
    opts.colormap ||
    opts.zoom ||
    opts.rescale ||
    opts.stretch ||
    opts.transparentBelowMin ||
    opts.bands
  ) {
    const prev = layer.metadata.rasterState;
    const rasterState: Record<string, unknown> =
      prev && typeof prev === "object" && !Array.isArray(prev) ? { ...prev } : {};
    if (opts.colormap) rasterState.colormap = opts.colormap;
    if (opts.rescale) rasterState.rescale = opts.rescale;
    if (opts.stretch) rasterState.stretch = opts.stretch;
    if (opts.transparentBelowMin) rasterState.transparentBelowMin = true;
    if (opts.bands) rasterState.bands = opts.bands;
    layer.metadata = { ...layer.metadata, ...(opts.zoom ? { zoomTo: true } : {}), rasterState };
  }
  return layer;
}

function hexColor(value: string): string {
  return /^[0-9a-f]{3,8}$/i.test(value) ? `#${value}` : value;
}

export function visToOpts(
  vis?: VisParams | null,
  name?: string,
  shown?: boolean,
  opacity?: number,
): AddOpts {
  const opts: AddOpts = {};
  if (vis) {
    if (vis.color) opts.color = hexColor(vis.color);
    if (vis.fillColor) opts.fill = hexColor(vis.fillColor);
    if (vis.fill) opts.fill = hexColor(vis.fill);
    if (vis.stroke) opts.stroke = hexColor(vis.stroke);
    if (vis.width !== undefined) opts.width = vis.width;
    if (typeof vis.colormap === "string") opts.colormap = vis.colormap;
    else if (typeof vis.palette === "string") opts.colormap = vis.palette;
    if (vis.min !== undefined || vis.max !== undefined) {
      opts.rescale = [[vis.min ?? 0, vis.max ?? 1]];
    }
    if (vis.bands) opts.bands = vis.bands;
    if (vis.stretch) opts.stretch = vis.stretch;
    if (vis.transparentBelowMin) opts.transparentBelowMin = true;
    if (vis.opacity !== undefined) opts.opacity = vis.opacity;
  }
  if (name) opts.name = name;
  if (shown !== undefined) opts.visible = shown;
  if (opacity !== undefined) opts.opacity = opacity;
  return opts;
}

async function fetchGeoJSON(url: string): Promise<FeatureCollection> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载失败 ${response.status}: ${url}`);
  return asCollection(await response.json());
}

function xyzOf(src: string, opts: AddOpts): GeoLibreLayer {
  return applyOpts(
    {
      id: crypto.randomUUID(),
      name: opts.name || "XYZ tiles",
      type: "xyz",
      source: {
        type: "raster",
        tiles: [src],
        tileSize: 256,
        attribution: opts.attribution ?? "",
      },
      visible: true,
      opacity: 1,
      style: { ...DEFAULT_LAYER_STYLE },
      metadata: {},
    },
    opts,
  );
}

export async function layersOf(
  src: AddSrc,
  opts: AddOpts = {},
  existing: GeoLibreLayer[] = [],
): Promise<GeoLibreLayer[]> {
  const kind = sniff(src, opts.type);
  if (typeof File !== "undefined" && src instanceof File) {
    if (kind === "cog") return [applyOpts(await createLocalRasterLayer(src), opts)];
    const collections = await readVectorFile(src);
    const layers: GeoLibreLayer[] = [];
    const seen = [...existing];
    for (const [index, collection] of collections.entries()) {
      const name =
        collection.fileName || (collections.length > 1 ? `${src.name} ${index + 1}` : src.name);
      const layer = applyOpts(createVectorLayer(name, collection, seen), opts);
      layers.push(layer);
      seen.push(layer);
    }
    return layers;
  }
  if (typeof src === "string") {
    if (kind === "xyz") return [xyzOf(src, opts)];
    if (kind === "cog") return [applyOpts(createRemoteRasterLayer(src), opts)];
    return [
      applyOpts(
        createVectorLayer(opts.name || fileName(src, "GeoJSON"), await fetchGeoJSON(src), existing),
        opts,
      ),
    ];
  }
  return [applyOpts(createVectorLayer(opts.name || "GeoJSON", asCollection(src), existing), opts)];
}

function push(layer: GeoLibreLayer): GeoLibreLayer {
  projectStore.getState().addLayers([layer]);
  return layer;
}

function paintPending(src: string | File, opts: AddOpts, existing: GeoLibreLayer[]): GeoLibreLayer {
  const label =
    opts.name || (typeof src === "string" ? fileName(src, "FeatureCollection") : src.name);
  const layer = applyOpts(
    createVectorLayer(label, { type: "FeatureCollection", features: [] }, existing),
    opts,
  );
  push(layer);
  void (async () => {
    try {
      const [next] = await layersOf(src, opts, existing);
      if (!next) return;
      projectStore.getState().updateLayer(layer.id, {
        name: next.name,
        type: next.type,
        source: next.source,
        geojson: next.geojson,
        style: next.style,
        metadata: next.metadata,
        opacity: next.opacity,
        visible: next.visible,
      });
    } catch (error) {
      console.error(error);
    }
  })();
  return layer;
}

function paintVector(data: FeatureCollection | string, opts: AddOpts, existing: GeoLibreLayer[]): GeoLibreLayer {
  if (typeof data === "string") return paintPending(data, opts, existing);
  return push(applyOpts(createVectorLayer(opts.name || "FeatureCollection", data, existing), opts));
}

function paintImage(url: string, opts: AddOpts): GeoLibreLayer {
  if (!url) throw new Error("Image 为空");
  return push(applyOpts(createRemoteRasterLayer(url), opts));
}

function paintTiles(pendingName: string, opts: AddOpts, load: () => Promise<string>): GeoLibreLayer {
  const layer = xyzOf(PENDING_EE_TILES, {
    ...opts,
    name: opts.name || pendingName,
  });
  push(layer);
  void load()
    .then((tiles) => {
      projectStore.getState().updateLayer(layer.id, {
        source: { type: "raster", tiles: [tiles], tileSize: 256 },
      });
    })
    .catch((error) => console.error(error));
  return layer;
}

function paintOfficial(obj: ee.Computed, vis: VisParams | null | undefined, opts: AddOpts): GeoLibreLayer {
  return paintTiles("Earth Engine", opts, async () => tilesFromMapId(await getMapResult(obj, vis ?? {})));
}

function simpleAssetId(obj: ee.Computed): string | undefined {
  const id = (obj as { args?: { id?: unknown } }).args?.id;
  return typeof id === "string" && /^[A-Za-z0-9_./-]+$/.test(id) ? id : undefined;
}

function paintEeComputed(obj: ee.Computed, vis: VisParams | null | undefined, opts: AddOpts): GeoLibreLayer {
  let graph = obj;
  if (vis?.composite === "yearSum") {
    graph = annualEt(obj as ImageCollection, vis.bands?.length ? String(vis.bands[0]) : "ET", vis.year);
  }
  const expr = encodeExpression(graph);
  const layer = xyzOf(PENDING_EE_TILES, {
    ...opts,
    name: opts.name || simpleAssetId(obj) || "Earth Engine",
  });
  layer.metadata = {
    ...layer.metadata,
    eeExpr: expr,
    eeAsset: simpleAssetId(obj),
    eeVis: {
      min: vis?.min,
      max: vis?.max,
      palette: vis?.palette,
      bands: vis?.bands,
      scale: vis?.scale,
    },
  };
  return push(layer);
}

function paintOfficialVector(obj: ee.Computed, opts: AddOpts, existing: GeoLibreLayer[]): GeoLibreLayer {
  const layer = applyOpts(
    createVectorLayer(opts.name || simpleAssetId(obj) || "Earth Engine", { type: "FeatureCollection", features: [] }, existing),
    opts,
  );
  layer.metadata = {
    ...layer.metadata,
    eeExpr: encodeExpression(obj),
    eeAsset: simpleAssetId(obj),
  };
  push(layer);
  const box = viewBounds();
  if (!box) return layer;
  const api = officialEe() as { Geometry?: { Rectangle: new (box: number[], proj: null, geodesic: boolean) => unknown } } | null;
  let table: ee.Computed & { filterBounds?: (geom: unknown) => ee.Computed; limit?: (n: number) => ee.Computed } = obj;
  if (api?.Geometry && typeof table.filterBounds === "function") {
    table = table.filterBounds(new api.Geometry.Rectangle(box, null, false));
  }
  if (typeof table.limit === "function") table = table.limit(2000);
  void runEe(table, "getInfo")
    .then((data) => {
      const geojson =
        data && typeof data === "object" && (data as { type?: string }).type === "Feature"
          ? { type: "FeatureCollection" as const, features: [data as Feature] }
          : asCollection(data);
      projectStore.getState().updateLayer(layer.id, { geojson });
    })
    .catch((error) => console.error(error));
  return layer;
}

/** GEE `Map.addLayer`：按 ee 类型分流；同步返回图层。 */
export function addLayer(
  obj: AddSrc,
  vis?: VisParams | null,
  name?: string,
  shown?: boolean,
  opacity?: number,
): GeoLibreLayer {
  const opts = visToOpts(vis, name, shown, opacity);
  const existing = projectStore.getState().project.layers;
  if (isOfficialEe(obj) && typeof obj.serialize === "function") {
    const kind = typeof obj.name === "function" ? obj.name() : "";
    if (kind === "Feature" || kind === "FeatureCollection" || kind === "Geometry") {
      return paintOfficialVector(obj, opts, existing);
    }
    return paintEeComputed(obj, vis, opts);
  }
  if (isOfficialEe(obj)) return paintOfficial(obj, vis, opts);
  const eeType = isEe(obj) ? obj.eeType : null;
  if (eeType === "Feature" && isEe(obj) && obj.eeType === "Feature") {
    if (obj.feature) return paintVector({ type: "FeatureCollection", features: [obj.feature] }, opts, existing);
    if (obj.url && isLocalVectorSrc(obj.url)) return paintPending(obj.url, opts, existing);
    throw new Error("请先 await ee.Initialize()");
  }
  if (eeType === "FeatureCollection" && isEe(obj) && obj.eeType === "FeatureCollection") {
    if (obj.collection) return paintVector(obj.collection, opts, existing);
    if (obj.url && isLocalVectorSrc(obj.url)) return paintPending(obj.url, opts, existing);
    throw new Error("请先 await ee.Initialize()");
  }
  if (eeType === "Image" && isEe(obj) && obj.eeType === "Image") {
    if (obj.file) return paintPending(obj.file, { ...opts, type: "cog" }, existing);
    if (obj.url && isLocalImageSrc(obj.url)) return paintImage(obj.url, opts);
    throw new Error("请先 await ee.Initialize()");
  }
  if (eeType === "ImageCollection" && isEe(obj) && obj.eeType === "ImageCollection") {
    const first = obj.urls[0] ?? "";
    if (isLocalImageSrc(first)) return paintImage(first, opts);
    throw new Error("请先 await ee.Initialize()");
  }
  const kind = sniff(obj, opts.type);
  if (
    (typeof File !== "undefined" && obj instanceof File) ||
    (typeof obj === "string" && kind === "geojson")
  ) {
    return paintPending(obj, opts, existing);
  }
  if (typeof obj === "string") {
    return push(kind === "xyz" ? xyzOf(obj, opts) : applyOpts(createRemoteRasterLayer(obj), opts));
  }
  return paintVector(asCollection(obj), opts, existing);
}

function commitGeometry(feature: Feature | null, opts: AddOpts): GeoLibreLayer {
  if (!feature) throw new Error("坐标不足");
  const { project, addLayer } = projectStore.getState();
  const used = project.layers.filter(isGeometryLayer).map((layer) => String(layer.metadata.color ?? ""));
  const color = opts.color || opts.stroke || nextGeometryColor(used);
  const layer = applyOpts(
    createGeometryLayer(opts.name || nextGeometryName(project.layers.map((layer) => layer.name)), color),
    opts,
  );
  layer.geojson = { type: "FeatureCollection", features: [feature] };
  addLayer(layer);
  return layer;
}

/** `[lng, lat]` */
export const addMarker = (at: Position, opts: AddOpts = {}) => commitGeometry(pointFeature(at), opts);
export const addPolyline = (path: Position[], opts: AddOpts = {}) => commitGeometry(lineFeature(path), opts);
export const addPolygon = (ring: Position[], opts: AddOpts = {}) => commitGeometry(polygonFeature(ring), opts);
export const addRect = (a: Position, b: Position, opts: AddOpts = {}) =>
  commitGeometry(polygonFeature(rectangleRing(a, b)), opts);

/** GEE `Map.addLayer`；挂在原生构造器上，不覆盖 `new Map()`。 */
export const Map = { addLayer };
Object.assign(globalThis.Map, Map);

declare global {
  interface MapConstructor {
    addLayer: typeof addLayer;
  }
  interface Window {
    ee: typeof import("./ee").ee;
  }
}
