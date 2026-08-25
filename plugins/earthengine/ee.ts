import type {
  Feature as GeoJSONFeature,
  FeatureCollection as GeoJSONFeatureCollection,
  Geometry,
} from "geojson";
import { projectStore } from "../../src/project-store";

export namespace ee {
  export type Type = "Feature" | "FeatureCollection" | "Image" | "ImageCollection";
  export type Feature = { eeType: "Feature"; feature?: GeoJSONFeature; url?: string };
  export type FeatureCollection = {
    eeType: "FeatureCollection";
    collection?: GeoJSONFeatureCollection;
    url?: string;
  };
  export type Image = { eeType: "Image"; url?: string; file?: File };
  export type ImageCollection = { eeType: "ImageCollection"; urls: string[] };
  export type Object = Feature | FeatureCollection | Image | ImageCollection;
  export type Api = {
    Image: new (id?: string) => unknown;
    Feature: new (...args: unknown[]) => unknown;
    FeatureCollection: new (...args: unknown[]) => unknown;
    ImageCollection: new (...args: unknown[]) => unknown;
    Initialize?: (...args: unknown[]) => void;
  };
  export type Computed = {
    getMap?: (vis: object, callback?: (map: unknown, error?: unknown) => void) => unknown;
    getMapId?: (vis: object, callback?: (map: unknown, error?: unknown) => void) => unknown;
  };
  export type MapId = { urlFormat?: string; mapid?: string; token?: string };
}

export function isLocalImageSrc(src: unknown): boolean {
  if (typeof File !== "undefined" && src instanceof File) return true;
  if (typeof src !== "string" || !src) return false;
  if (/\{[xyz]\}/i.test(src)) return true;
  if (/^https?:\/\//i.test(src)) return true;
  return /\.(tif|tiff|cog)(\?|#|$)/i.test(src);
}

export function isLocalVectorSrc(src: unknown): boolean {
  if (typeof File !== "undefined" && src instanceof File) return true;
  if (typeof src === "string") {
    if (!src) return false;
    if (/^https?:\/\//i.test(src)) return true;
    return /\.(geojson|json)(\?|#|$)/i.test(src);
  }
  if (!src || typeof src !== "object") return false;
  if (isEe(src)) return src.eeType === "Feature" || src.eeType === "FeatureCollection";
  const type = (src as { type?: unknown }).type;
  return type === "Feature" || type === "FeatureCollection" || "coordinates" in src;
}

export function isEe(value: unknown): value is ee.Object {
  return Boolean(value && typeof value === "object" && "eeType" in value);
}

export function eeKind(value: unknown): ee.Type | null {
  return isEe(value) ? value.eeType : null;
}

export function isOfficialEe(value: unknown): value is ee.Computed {
  if (!value || typeof value !== "object" || "eeType" in value) return false;
  const obj = value as ee.Computed;
  return typeof obj.getMap === "function" || typeof obj.getMapId === "function";
}

function asFeature(geometry: Geometry | GeoJSONFeature, properties?: Record<string, unknown>): GeoJSONFeature {
  if ("type" in geometry && geometry.type === "Feature") return geometry;
  return { type: "Feature", properties: properties ?? {}, geometry: geometry as Geometry };
}

function Feature(
  geometry: string | Geometry | GeoJSONFeature,
  properties?: Record<string, unknown>,
): ee.Feature {
  if (typeof geometry === "string") return { eeType: "Feature", url: geometry };
  return { eeType: "Feature", feature: asFeature(geometry, properties) };
}

function FeatureCollection(
  data: string | GeoJSONFeature[] | GeoJSONFeatureCollection | ee.Feature[],
): ee.FeatureCollection {
  if (typeof data === "string") return { eeType: "FeatureCollection", url: data };
  if (Array.isArray(data)) {
    return {
      eeType: "FeatureCollection",
      collection: {
        type: "FeatureCollection",
        features: data.flatMap((item) => {
          if (isEe(item) && item.eeType === "Feature") return item.feature ? [item.feature] : [];
          return [item];
        }),
      },
    };
  }
  return { eeType: "FeatureCollection", collection: data };
}

function Image(src: string | File): ee.Image {
  if (typeof File !== "undefined" && src instanceof File) return { eeType: "Image", file: src, url: src.name };
  return { eeType: "Image", url: src };
}

function ImageCollection(src: string | string[] | ee.Image[]): ee.ImageCollection {
  const urls = Array.isArray(src)
    ? src.map((item) => (typeof item === "string" ? item : item.url ?? "")).filter(Boolean)
    : [src];
  return { eeType: "ImageCollection", urls };
}

const local = { Feature, FeatureCollection, Image, ImageCollection };

export function bindEarthEngine(api: ee.Api): ee.Api {
  const wrapped = {
    Image: (src: string | File) =>
      isLocalImageSrc(src) ? local.Image(src) : new api.Image(typeof src === "string" ? src : src.name),
    Feature: (geometry: unknown, properties?: unknown) =>
      isLocalVectorSrc(geometry)
        ? local.Feature(geometry as Geometry | GeoJSONFeature, properties as Record<string, unknown> | undefined)
        : new api.Feature(geometry, properties),
    FeatureCollection: (data: unknown) =>
      isLocalVectorSrc(data) ? local.FeatureCollection(data as never) : new api.FeatureCollection(data),
    ImageCollection: (src: unknown) => {
      const useLocal =
        isLocalImageSrc(src) ||
        (Array.isArray(src) &&
          src.every((item) => isLocalImageSrc(item) || (isEe(item) && item.eeType === "Image")));
      return useLocal ? local.ImageCollection(src as never) : new api.ImageCollection(src as never);
    },
  };
  return new Proxy(api, {
    get(target, prop, receiver) {
      if (prop in wrapped) return wrapped[prop as keyof typeof wrapped];
      return Reflect.get(target, prop, receiver);
    },
  }) as ee.Api;
}

export type EeKind = "Image" | "ImageCollection" | "Feature" | "FeatureCollection";
export type EeVis = {
  min?: number;
  max?: number;
  palette?: string | string[];
  bands?: Array<string | number>;
  gamma?: number;
  colormap?: string;
  composite?: "yearSum";
  year?: number;
  scale?: number;
};
export type BBox = [number, number, number, number];

function eeBase(): string {
  return import.meta.env?.BASE_URL ?? "/project-demo/";
}

export function eeMapUrl(
  asset: string,
  vis?: EeVis | null,
  kind: Extract<EeKind, "Image" | "ImageCollection"> = "Image",
): string {
  const q = new URLSearchParams({ id: asset, kind });
  if (vis?.min != null) q.set("min", String(vis.min));
  if (vis?.max != null) q.set("max", String(vis.max));
  if (vis?.palette) q.set("palette", Array.isArray(vis.palette) ? vis.palette.join(",") : vis.palette);
  else if (vis?.gamma != null) q.set("gamma", String(vis.gamma));
  if (vis?.bands?.length) q.set("bands", vis.bands.join(","));
  if (vis?.composite) q.set("composite", vis.composite);
  if (vis?.year != null) q.set("year", String(vis.year));
  if (vis?.scale != null) q.set("gain", String(vis.scale));
  return `${eeBase()}api/ee/map?${q}`;
}

export function eeSampleUrl(
  asset: string,
  vis: EeVis | null | undefined,
  kind: Extract<EeKind, "Image" | "ImageCollection">,
  lng: number,
  lat: number,
  scale: number,
): string {
  const q = new URLSearchParams({
    id: asset,
    kind,
    lng: String(lng),
    lat: String(lat),
    scale: String(scale),
  });
  if (vis?.bands?.length) q.set("bands", vis.bands.join(","));
  if (vis?.composite) q.set("composite", vis.composite);
  if (vis?.year != null) q.set("year", String(vis.year));
  if (vis?.scale != null) q.set("gain", String(vis.scale));
  return `${eeBase()}api/ee/sample?${q}`;
}

export async function fetchEeSample(
  asset: string,
  vis: EeVis | null | undefined,
  kind: Extract<EeKind, "Image" | "ImageCollection">,
  lng: number,
  lat: number,
  scale: number,
): Promise<Record<string, unknown>> {
  const response = await fetch(eeSampleUrl(asset, vis, kind, lng, lat, scale));
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json();
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  return data as Record<string, unknown>;
}

export async function fetchEeTiles(
  asset: string,
  vis?: EeVis | null,
  kind: Extract<EeKind, "Image" | "ImageCollection"> = "Image",
): Promise<string> {
  const response = await fetch(eeMapUrl(asset, vis, kind));
  if (!response.ok) throw new Error(await response.text());
  const data = (await response.json()) as { urlFormat?: string };
  if (!data.urlFormat) throw new Error("Earth Engine 未返回瓦片 URL");
  return data.urlFormat;
}

export function viewBounds(): BBox | null {
  const map = (globalThis as {
    __map?: { getBounds?: () => { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number } };
  }).__map;
  const box = map?.getBounds?.();
  return box ? [box.getWest(), box.getSouth(), box.getEast(), box.getNorth()] : null;
}

export function eeGeoUrl(
  asset: string,
  kind: Extract<EeKind, "Feature" | "FeatureCollection">,
  bbox?: BBox | null,
): string {
  const q = new URLSearchParams({ id: asset, kind });
  if (bbox) {
    q.set("west", String(bbox[0]));
    q.set("south", String(bbox[1]));
    q.set("east", String(bbox[2]));
    q.set("north", String(bbox[3]));
  }
  return `${eeBase()}api/ee/geojson?${q}`;
}

export async function fetchEeGeoJSON(
  asset: string,
  kind: Extract<EeKind, "Feature" | "FeatureCollection">,
  bbox?: BBox | null,
): Promise<GeoJSONFeatureCollection> {
  const response = await fetch(eeGeoUrl(asset, kind, bbox));
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json();
  if (data && typeof data === "object" && data.type === "Feature") {
    return { type: "FeatureCollection", features: [data as GeoJSONFeature] };
  }
  if (data && typeof data === "object" && data.type === "FeatureCollection" && Array.isArray(data.features)) {
    return data as GeoJSONFeatureCollection;
  }
  throw new Error("Earth Engine 未返回 GeoJSON");
}

export function eeBandsUrl(
  asset: string,
  kind: Extract<EeKind, "Image" | "ImageCollection"> = "Image",
): string {
  return `${eeBase()}api/ee/bands?${new URLSearchParams({ id: asset, kind })}`;
}

const bandCache = new Map<string, Promise<string[]>>();

export function fetchEeBands(
  asset: string,
  kind: Extract<EeKind, "Image" | "ImageCollection"> = "Image",
): Promise<string[]> {
  const key = `${kind}:${asset}`;
  const hit = bandCache.get(key);
  if (hit) return hit;
  const pending = fetch(eeBandsUrl(asset, kind))
    .then(async (response) => {
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as { bands?: unknown };
      return Array.isArray(data.bands) ? data.bands.map(String) : [];
    })
    .catch((error) => {
      bandCache.delete(key);
      throw error;
    });
  bandCache.set(key, pending);
  return pending;
}

export function isGeeRaster(layer: { type?: string; metadata?: { eeAsset?: unknown } }): boolean {
  return layer.type === "xyz" && typeof layer.metadata?.eeAsset === "string";
}

export function visFromGeeLayer(layer: {
  metadata?: { eeVis?: unknown; rasterState?: unknown };
}): EeVis {
  const raw = layer.metadata?.eeVis;
  const vis: EeVis =
    raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as EeVis) } : {};
  const state =
    layer.metadata?.rasterState && typeof layer.metadata.rasterState === "object"
      ? (layer.metadata.rasterState as Record<string, unknown>)
      : {};
  const range = Array.isArray(state.rescale) ? state.rescale[0] : null;
  if (Array.isArray(range) && range.length === 2) {
    vis.min = Number(range[0]);
    vis.max = Number(range[1]);
  }
  if (typeof state.colormap === "string" && /[,#]|[0-9a-f]{6}/i.test(state.colormap)) {
    vis.palette = state.colormap.split(",").map((item) => item.trim()).filter(Boolean);
  }
  if (Array.isArray(state.bands) && state.bands.length) vis.bands = state.bands as Array<string | number>;
  return vis;
}

const geeFp = new Map<string, string>();

export function syncGeeRaster(layer: {
  id: string;
  type?: string;
  metadata?: { eeAsset?: unknown; eeKind?: unknown; eeVisFp?: unknown; eeVis?: unknown; rasterState?: unknown };
}): void {
  if (!isGeeRaster(layer) || typeof layer.metadata?.eeAsset !== "string") return;
  const kind = layer.metadata.eeKind === "ImageCollection" ? "ImageCollection" : "Image";
  const vis = visFromGeeLayer(layer);
  const fp = JSON.stringify(vis);
  if (layer.metadata.eeVisFp === fp || geeFp.get(layer.id) === fp) return;
  geeFp.set(layer.id, fp);
  void fetchEeTiles(layer.metadata.eeAsset, vis, kind)
    .then((tiles) => {
      if (geeFp.get(layer.id) !== fp) return;
      const current = projectStore.getState().project.layers.find((item) => item.id === layer.id);
      if (!current) return;
      projectStore.getState().updateLayer(layer.id, {
        source: { type: "raster", tiles: [tiles], tileSize: 256 },
        metadata: { ...current.metadata, eeVisFp: fp },
      });
    })
    .catch((error) => {
      if (geeFp.get(layer.id) === fp) geeFp.delete(layer.id);
      console.error(error);
    });
}

let ready: Promise<void> | null = null;

/** 预热 Node `ee-auth`；GEE 资产仍走 local stub + `/api/ee/map`。 */
export function Initialize(_project?: string | { project?: string }): Promise<void> {
  if (!ready) {
    const base = import.meta.env?.BASE_URL ?? "/project-demo/";
    ready = fetch(`${base}api/ee/ready`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
      })
      .catch((error) => {
        ready = null;
        throw error;
      });
  }
  return ready;
}

export const ee = { Feature, FeatureCollection, Image, ImageCollection, Initialize };

export function getMapResult(obj: ee.Computed, vis: object): Promise<ee.MapId> {
  return new Promise((resolve, reject) => {
    const fn = obj.getMap ?? obj.getMapId;
    if (!fn) return reject(new Error("不是 Earth Engine 对象"));
    let settled = false;
    const done = (error: unknown, result?: unknown) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve((result ?? {}) as ee.MapId);
    };
    try {
      const ret = fn.call(obj, vis, (a: unknown, b: unknown) => {
        const map = a && typeof a === "object" && ("urlFormat" in a || "mapid" in a) ? a : b;
        const error = map === a ? b : a;
        done(error, map);
      });
      if (ret && typeof (ret as Promise<unknown>).then === "function") {
        void (ret as Promise<unknown>).then((result) => done(null, result), done);
      }
    } catch (error) {
      done(error);
    }
  });
}

export function tilesFromMapId(map: ee.MapId): string {
  if (map.urlFormat) return map.urlFormat;
  if (map.mapid) {
    const token = map.token ? `?token=${map.token}` : "";
    return `https://earthengine.googleapis.com/map/${map.mapid}/{z}/{x}/{y}${token}`;
  }
  throw new Error("Earth Engine 未返回瓦片 URL");
}
