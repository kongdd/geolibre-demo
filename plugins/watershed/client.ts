import type { FeatureCollection } from "geojson";

export interface Outlet {
  lon: number;
  lat: number;
  id?: number;
}

export interface WatershedRasters {
  flowdirs: string[];
  flowaccus: string[];
}

interface WatershedResponse {
  pour_points_geojson: string;
  watershed_geojson: string | null;
  basin_stats: Array<{ id: number; area_km2: number }>;
  walls_ms: number;
}

interface WatershedOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  flowdir?: string;
  flowaccu?: string;
  snapDistanceM?: number;
  snapMainChannelFrac?: number;
}

export class WatershedApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WatershedApiError";
  }
}

function apiUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/watershed`;
}

function parseCollection(value: unknown, label: string): FeatureCollection {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { type?: unknown }).type !== "FeatureCollection" ||
    !Array.isArray((parsed as { features?: unknown }).features)
  ) {
    throw new Error(`${label} 不是 GeoJSON FeatureCollection`);
  }
  return parsed as FeatureCollection;
}

export async function listWatershedRasters(
  options: Pick<WatershedOptions, "baseUrl" | "fetch"> = {},
): Promise<WatershedRasters> {
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const response = await fetchFn(`${apiUrl(options.baseUrl ?? "/api")}/rasters`);
  if (!response.ok) throw new WatershedApiError(await response.text(), response.status);
  return (await response.json()) as WatershedRasters;
}

export function createWatershedExtractor(options: WatershedOptions = {}) {
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const snapDistanceM = options.snapDistanceM ?? 200;
  const snapMainChannelFrac = options.snapMainChannelFrac ?? 0.95;
  if (!Number.isFinite(snapDistanceM) || snapDistanceM < 0) {
    throw new RangeError("河道捕捉距离必须是非负有限数");
  }
  if (!Number.isFinite(snapMainChannelFrac) || snapMainChannelFrac < 0 || snapMainChannelFrac > 1) {
    throw new RangeError("主河道阈值必须在 0 到 1 之间");
  }
  if (options.flowdir && snapDistanceM > 0 && !options.flowaccu) {
    throw new TypeError("启用捕捉时必须选择 FlowAccum");
  }

  return {
    async extract(input: Outlet | readonly Outlet[], signal?: AbortSignal) {
      const outlets = Array.isArray(input) ? input : [input];
      if (
        !outlets.length ||
        outlets.some((outlet) => !Number.isFinite(outlet.lon) || !Number.isFinite(outlet.lat))
      ) {
        throw new TypeError("出水口坐标无效");
      }
      const points = outlets.map((outlet, index) => ({
        id: outlet.id ?? index + 1,
        lon: outlet.lon,
        lat: outlet.lat,
      }));
      const ids = new Set(points.map(({ id }) => id));
      if (
        ids.size !== points.length ||
        points.some(({ id }) => !Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647)
      ) {
        throw new TypeError("出水口 ID 必须是唯一的正整数");
      }
      const baseUrl = options.baseUrl ?? "/api";
      const response = await fetchFn(apiUrl(baseUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          points,
          ...(options.flowdir ? { flowdir: options.flowdir } : {}),
          ...(options.flowaccu ? { flowaccu: options.flowaccu } : {}),
          snap_dist_m: snapDistanceM,
          snap_main_channel_frac: snapMainChannelFrac,
        }),
        signal,
      });
      if (!response.ok) {
        throw new WatershedApiError((await response.text()) || response.statusText, response.status);
      }
      const payload = (await response.json()) as WatershedResponse;
      return {
        response: payload,
        watershed:
          payload.watershed_geojson === null
            ? null
            : parseCollection(payload.watershed_geojson, "流域边界"),
        pourPoints: parseCollection(payload.pour_points_geojson, "出水口"),
      };
    },
  };
}
