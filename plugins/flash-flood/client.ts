/**
 * FLASHCAST browser client.
 * Contracts follow SpatialHydro/packages/flashcast-sdk without adding a runtime dependency.
 */
import type { FeatureCollection } from "geojson";

/** 十堰 24 站中的 6 个国家基本站 */
export const NATIONAL_BASIC_STATIONS = ["贾家坊", "松柏（二）", "孤山", "县河", "延坝", "房县"] as const;
const NATIONAL_SET = new Set<string>(NATIONAL_BASIC_STATIONS);

export function isNationalBasicStation(site: string): boolean {
  return NATIONAL_SET.has(site);
}

export function groupGaugedSites(sites: string[]): { national: string[]; regional: string[] } {
  const collator = (a: string, b: string) => a.localeCompare(b, "zh-CN");
  return {
    national: sites.filter(isNationalBasicStation).sort(collator),
    regional: sites.filter((site) => !isNationalBasicStation(site)).sort(collator),
  };
}

export interface UngaugedSite {
  id: number;
  name: string;
  site?: string;
  lon?: number;
  lat?: number;
  group_id?: string;
}

export interface HydroSeries {
  time: string[];
  P: number[];
  PET?: number[];
  Q_obs: Array<number | null>;
  Q_sim: Array<number | null>;
  step?: number;
  n_full?: number;
  source_idx?: number[];
}

export interface ModelMetrics {
  NSE?: number | null;
  KGE?: number | null;
  R2?: number | null;
  Bias?: number | null;
  n?: number | null;
}

export interface EventRow {
  id: string;
  split: string;
  start: string;
  end: string;
  duration_h: number;
  peak: number;
  peak_sim: number | null;
  NSE: number | null;
  KGE: number | null;
  R2: number | null;
  peak_bias: number | null;
  start_idx: number;
  end_idx: number;
}

export interface StageSummary extends ModelMetrics {
  split: string;
  hours: number;
}

export interface SimulationResult {
  site: string;
  model_id?: string;
  area_km2: number;
  params: Record<string, number>;
  param_source?: string;
  metrics: ModelMetrics;
  metrics_train?: ModelMetrics;
  metrics_valid?: ModelMetrics;
  events: EventRow[];
  stages?: StageSummary[];
  series: HydroSeries;
  period?: { start: string; end: string; n: number };
  from_cache?: boolean;
}

export interface ForecastResult {
  site: string;
  model_id?: string;
  area_km2: number;
  params: Record<string, number>;
  param_source?: string;
  history: Pick<SimulationResult, "series" | "metrics" | "events" | "period">;
  forecast: Pick<SimulationResult, "series" | "metrics" | "events" | "period">;
}

export interface ModelParam {
  name: string;
  label?: string;
  description?: string;
  min: number;
  max: number;
  value: number;
  recommended?: number;
  unit?: string;
  group?: string;
}

export interface SensitivityResponse {
  site: string;
  model_id: string;
  metric: "KGE";
  nstep: number;
  params: Record<string, number>;
  period: { start: string; end: string; n: number };
  curves: Array<{
    name: string;
    score: number | null;
    points: Array<{ theta: number; gof: number | null }>;
  }>;
}

export interface ForcingPayload {
  P: number[];
  PET?: number[];
  Q?: number[];
  R?: number[];
  time?: string[];
}

export interface EventRules {
  qMin: number;
  qPeak: number;
  gapMaxHours: number;
  minHours: number;
  gapHours: number;
  extendHours: number;
}

export interface CalibrationJob {
  job_id: string;
  site?: string;
  status: "queued" | "running" | "done" | "cancelled" | "failed";
  maxn?: number;
  iter?: number;
  feval?: number;
  best_gof?: number | null;
  message?: string;
  from_cache?: boolean;
  error?: string | null;
  result?: SimulationResult;
}

export interface FlashFloodClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class FlashFloodApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = "FlashFloodApiError";
  }
}

export function eventRuleFields(rules: EventRules): Record<string, number> {
  return {
    threshold: rules.qPeak,
    q_min: rules.qMin,
    q_peak: rules.qPeak,
    gap_max_days: rules.gapMaxHours / 24,
    min_hours: rules.minHours,
    gap_hours: rules.gapHours,
    extend_hours: rules.extendHours,
  };
}

export function sliceForcingByWindow(
  forcing: ForcingPayload,
  start: string,
  end: string,
): ForcingPayload {
  if (!forcing.time) throw new Error("未来预报使用本地 CSV 时必须提供 time 列");
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    throw new Error("预报时间窗口无效");
  }
  const indices = forcing.time.flatMap((time, index) => {
    const value = Date.parse(time);
    return value >= startMs && value <= endMs ? [index] : [];
  });
  if (!indices.length) throw new Error("本地 CSV 在所选预报窗口内没有数据");
  const pick = (values?: number[]) => values ? indices.map((index) => values[index]!) : undefined;
  return {
    P: pick(forcing.P)!,
    ...(forcing.PET ? { PET: pick(forcing.PET) } : {}),
    ...(forcing.Q ? { Q: pick(forcing.Q) } : {}),
    ...(forcing.R ? { R: pick(forcing.R) } : {}),
    time: indices.map((index) => forcing.time![index]!),
  };
}

export function parseForcingCsv(text: string): ForcingPayload {
  const rows = text.trim().split(/\r?\n/).filter(Boolean);
  if (rows.length < 2) throw new Error("CSV 至少需要表头和一行数据");
  const split = (line: string) => line.split(/,|\t/).map((item) => item.trim().replace(/^"|"$/g, ""));
  const headers = split(rows[0]!).map((item) => item.toLowerCase());
  const find = (...names: string[]) => headers.findIndex((item) => names.includes(item));
  const columns = {
    time: find("time", "date", "datetime", "timestamp"),
    P: find("p", "precip", "precipitation", "rain"),
    PET: find("pet", "pet_romanenko", "evap", "evaporation"),
    Q: find("q", "q_obs", "flow", "discharge"),
    R: find("r", "runoff"),
  };
  if (columns.P < 0) throw new Error("CSV 缺少降雨列 P");
  const output: ForcingPayload = { P: [] };
  if (columns.time >= 0) output.time = [];
  if (columns.PET >= 0) output.PET = [];
  if (columns.Q >= 0) output.Q = [];
  if (columns.R >= 0) output.R = [];
  for (const [rowIndex, line] of rows.slice(1).entries()) {
    const values = split(line);
    const numberAt = (index: number, name: string): number => {
      const value = Number(values[index]);
      if (!Number.isFinite(value)) throw new Error(`CSV 第 ${rowIndex + 2} 行 ${name} 不是有效数字`);
      return value;
    };
    output.P.push(numberAt(columns.P, "P"));
    if (output.time) output.time.push(values[columns.time] ?? "");
    if (output.PET) output.PET.push(numberAt(columns.PET, "PET"));
    if (output.Q) output.Q.push(numberAt(columns.Q, "Q"));
    if (output.R) output.R.push(numberAt(columns.R, "R"));
  }
  if (output.time?.some((item) => !item)) throw new Error("CSV 时间列存在空值");
  return output;
}

async function parseResponse<T>(response: Response, url: string): Promise<T> {
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = undefined;
  }
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error: unknown }).error)
      : text || response.statusText;
    throw new FlashFloodApiError(`${response.status} ${detail}`, response.status, url);
  }
  if (payload === undefined) throw new FlashFloodApiError("服务返回空响应", response.status, url);
  return payload as T;
}

export function createFlashFloodClient(options: FlashFloodClientOptions = {}) {
  const base = (options.baseUrl ?? "/api").replace(/\/+$/, "");
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const url = (path: string) => `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const get = async <T>(path: string, signal?: AbortSignal): Promise<T> => {
    const target = url(path);
    return parseResponse<T>(await fetchFn(target, { signal }), target);
  };
  const post = async <T>(path: string, body: object, signal?: AbortSignal): Promise<T> => {
    const target = url(path);
    return parseResponse<T>(await fetchFn(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }), target);
  };

  return {
    health: (signal?: AbortSignal) => get<{ status: string }>("/health", signal),
    sites: async (signal?: AbortSignal) => (await get<{ sites: string[] }>("/model/sites", signal)).sites,
    catalog: (signal?: AbortSignal) => get<{
      default: string;
      models: Array<{ id: string; label: string; n_params: number }>;
    }>("/model/catalog", signal),
    params: async (site: string, model: string, signal?: AbortSignal) => {
      const result = await get<{
        params: Array<ModelParam & { lower?: number; upper?: number }>;
        source?: string;
        calibration_hint?: { has_calibrated: boolean; maxn: number | null; updated?: string };
      }>(`/model/params?site=${encodeURIComponent(site)}&model=${encodeURIComponent(model)}`, signal);
      return {
        ...result,
        params: result.params.map(({ lower, upper, ...param }) => ({
          ...param,
          min: param.min ?? lower ?? 0,
          max: param.max ?? upper ?? 1,
          recommended: param.recommended ?? param.value,
        })),
      };
    },
    forcing: (site: string, signal?: AbortSignal) => get<{
      site: string;
      area_km2: number;
      period: { start: string; end: string; n: number };
      series?: HydroSeries;
    }>(`/model/forcing/${encodeURIComponent(site)}`, signal),
    floodRules: (signal?: AbortSignal) => get<{
      default: { Q_min: number; Q_peak: number; gap_max_days?: number };
      sites: Record<string, { Q_min: number; Q_peak: number; gap_max_days?: number }>;
    }>("/model/flood-rules", signal),
    basinsGeoJson: (signal?: AbortSignal) => get<FeatureCollection>("/basins/geojson", signal),
    ungaugedCatalog: (signal?: AbortSignal) => get<{
      sites?: UngaugedSite[];
      groups?: Array<{ id: string; name: string }>;
    }>("/basins/ungauged/catalog", signal),
    divideEvents: (body: object, signal?: AbortSignal) =>
      post<SimulationResult>("/model/events/divide", body, signal),
    simulate: (body: object, signal?: AbortSignal) =>
      post<SimulationResult>("/model/simulate", body, signal),
    sensitivity: (body: object, signal?: AbortSignal) =>
      post<SensitivityResponse>("/model/sensitivity", body, signal),
    forecast: (body: object, signal?: AbortSignal) =>
      post<ForecastResult>("/model/forecast", body, signal),
    startCalibration: (body: object, signal?: AbortSignal) =>
      post<{ job_id: string; status: string }>("/model/calibrate/start", body, signal),
    calibrationJob: (jobId: string, signal?: AbortSignal) =>
      get<CalibrationJob>(`/model/calibrate/${encodeURIComponent(jobId)}`, signal),
    cancelCalibration: (jobId: string, signal?: AbortSignal) =>
      post<{ job_id: string; cancelled: boolean }>(`/model/calibrate/${encodeURIComponent(jobId)}/cancel`, {}, signal),
  };
}
