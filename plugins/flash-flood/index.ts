import type { Feature, FeatureCollection, Geometry } from "geojson";
import { LngLatBounds, type Map as MapLibreMap } from "maplibre-gl";
import { setStatus } from "geolibre-lite/dom";
import { projectStore } from "geolibre-lite/project/store";
import { createVectorLayer } from "geolibre-lite/vector";
import {
  createFlashFloodClient,
  eventRuleFields,
  groupGaugedSites,
  parseForcingCsv,
  sliceForcingByWindow,
  type UngaugedSite,
  type CalibrationJob,
  type EventRow,
  type EventRules,
  type ForcingPayload,
  type ForecastResult,
  type ModelMetrics,
  type ModelParam,
  type SensitivityResponse,
  type SimulationResult,
} from "./client";
import { mergeForecastSeries, renderHydrograph, renderSensitivityChart } from "./charts";

export interface FlashFloodPlugin {
  close(): boolean;
  dispose(): void;
}

const DEFAULT_RULES: EventRules = {
  qMin: 2,
  qPeak: 10,
  gapMaxHours: 48,
  minHours: 3,
  gapHours: 4,
  extendHours: 3,
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatMetric(value: number | null | undefined, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function metricTone(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "muted";
  return value >= 0.75 ? "good" : value >= 0.5 ? "warn" : "bad";
}

function dateTimeValue(value: string): string {
  return value.replace(" ", "T").slice(0, 16);
}

/** SpatialHydro timestamps are timezone-naive UTC; do not let browser locale shift them. */
function apiDate(value: string): Date {
  const iso = value.replace(" ", "T");
  return new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(iso) ? iso : `${iso}Z`);
}

function byData<T extends HTMLElement>(root: ParentNode, name: string): T {
  const value = root.querySelector<T>(`[data-${name}]`);
  if (!value) throw new Error(`FlashFlood UI missing [data-${name}]`);
  return value;
}

function numberValue(root: ParentNode, name: string): number {
  const value = Number(byData<HTMLInputElement>(root, name).value);
  if (!Number.isFinite(value)) throw new Error(`${name} 不是有效数字`);
  return value;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("已取消", "AbortError"));
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("已取消", "AbortError"));
    }, { once: true });
  });
}

function metricsHtml(metrics: ModelMetrics = {}): string {
  const items: Array<[string, number | null | undefined]> = [
    ["NSE", metrics.NSE], ["KGE", metrics.KGE], ["R²", metrics.R2], ["Bias", metrics.Bias],
  ];
  return items.map(([label, value]) => `
    <article class="ff-metric ${metricTone(label === "Bias" && typeof value === "number" ? 1 - Math.abs(value) / 100 : value)}">
      <span>${label}</span><b>${formatMetric(value)}</b>
    </article>`).join("");
}

function eventsHtml(events: EventRow[]): string {
  if (!events.length) return '<tr><td colspan="8" class="ff-table-empty">未识别到洪水场次</td></tr>';
  return events.slice(0, 120).map((event) => `
    <tr>
      <td><b>${escapeHtml(event.id)}</b></td>
      <td><span class="ff-stage ${event.split.toLowerCase()}">${escapeHtml(event.split)}</span></td>
      <td>${escapeHtml(event.start.replace("T", " ").slice(0, 16))}</td>
      <td>${formatMetric(event.duration_h, 0)} h</td>
      <td>${formatMetric(event.peak, 1)}</td>
      <td class="${metricTone(event.NSE)}">${formatMetric(event.NSE)}</td>
      <td class="${metricTone(event.KGE)}">${formatMetric(event.KGE)}</td>
      <td>${formatMetric(event.peak_bias, 1)}%</td>
    </tr>`).join("");
}

function coordinatesOf(geometry: Geometry | null): number[][] {
  if (!geometry) return [];
  if (geometry.type === "GeometryCollection") return geometry.geometries.flatMap(coordinatesOf);
  const flatten = (value: unknown): number[][] => {
    if (!Array.isArray(value)) return [];
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      return [[value[0], value[1]]];
    }
    return value.flatMap(flatten);
  };
  return flatten(geometry.coordinates);
}

function siteName(feature: Feature): string {
  const properties = feature.properties ?? {};
  return String(properties.site ?? properties.name ?? properties.NAME ?? properties.站名 ?? "");
}

function panelTemplate(): string {
  return `
    <header class="ff-header">
      <div class="ff-brand-mark"><span></span></div>
      <div><strong>FLASH<span>FLOOD</span></strong><small>SPATIALHYDRO · OPERATIONAL STUDIO</small></div>
      <div class="ff-live"><i></i><span data-service-state>等待连接</span></div>
      <button type="button" class="ff-close" data-close aria-label="关闭山洪预报">×</button>
    </header>
    <div class="ff-context">
      <label><span>控制流域</span><select data-site aria-label="控制流域"><option>载入中…</option></select></label>
      <label><span>水文模型</span><select data-model aria-label="水文模型"><option>载入中…</option></select></label>
      <label><span>历史起点</span><input data-start type="datetime-local" /></label>
      <label><span>历史终点</span><input data-end type="datetime-local" /></label>
      <button type="button" class="ff-focus" data-focus>⌖ 地图定位</button>
    </div>
    <div class="ff-body">
      <nav class="ff-nav" aria-label="山洪预报工作流">
        <button type="button" class="active" data-tab="data"><b>01</b><span>数据舱</span></button>
        <button type="button" data-tab="events"><b>02</b><span>场次划分</span></button>
        <button type="button" data-tab="calibration"><b>03</b><span>参数率定</span></button>
        <button type="button" data-tab="sensitivity"><b>04</b><span>敏感性</span></button>
        <button type="button" data-tab="history"><b>05</b><span>历史模拟</span></button>
        <button type="button" data-tab="forecast"><b>06</b><span>未来预报</span></button>
      </nav>
      <div class="ff-pages">
        <section class="ff-page active" data-page="data">
          <div class="ff-page-title"><div><span>DATA INGESTION</span><h2>多源水文数据舱</h2><p>流域空间数据、站点强迫与观测序列统一接入。</p></div><button type="button" class="ff-primary" data-refresh>刷新数据链</button></div>
          <div class="ff-stat-grid" data-data-stats>
            <article><span>监测流域</span><b>—</b><small>SpatialHydro catalog</small></article>
            <article><span>流域面积</span><b>—</b><small>km²</small></article>
            <article><span>时间步数</span><b>—</b><small>hourly forcing</small></article>
            <article><span>参数来源</span><b>—</b><small>model state</small></article>
          </div>
          <div class="ff-grid-2">
            <article class="ff-card ff-source-card">
              <div class="ff-card-head"><div><span>REMOTE SOURCE</span><h3>SpatialHydro 服务</h3></div><i class="ff-pulse"></i></div>
              <dl data-source-detail><dt>端点</dt><dd>/api/model</dd><dt>状态</dt><dd>等待连接</dd></dl>
            </article>
            <article class="ff-card ff-source-card">
              <div class="ff-card-head"><div><span>LOCAL OVERRIDE</span><h3>本地强迫 CSV</h3></div><b data-local-badge>未载入</b></div>
              <p>P 为必需列；支持 time、PET_Romanenko、Q、R。预报时按历史窗与未来窗自动切分。</p>
              <input data-csv-file type="file" accept=".csv,.txt" hidden />
              <div class="ff-inline-actions"><button type="button" data-load-csv>载入 CSV</button><button type="button" data-clear-csv disabled>清除</button></div>
            </article>
          </div>
          <article class="ff-card"><div class="ff-card-head"><div><span>FORCING WINDOW</span><h3>当前数据窗口</h3></div></div><div class="ff-window-line" data-window-line>选择流域后读取数据元信息</div></article>
        </section>

        <section class="ff-page" data-page="events">
          <div class="ff-page-title"><div><span>EVENT INTELLIGENCE</span><h2>洪水场次划分</h2><p>对齐 HydroFloods 规则，训练与验证场次清晰隔离。</p></div><button type="button" class="ff-primary" data-run-events>识别场次</button></div>
          <div class="ff-rule-grid">
            <label><span>起涨阈值 Q<sub>min</sub></span><input data-q-min type="number" step="0.1" value="2" /><small>m³/s</small></label>
            <label><span>洪峰阈值 Q<sub>peak</sub></span><input data-q-peak type="number" step="0.1" value="10" /><small>m³/s</small></label>
            <label><span>场间间隔</span><input data-gap-max type="number" step="1" value="48" /><small>h</small></label>
            <label><span>最短历时</span><input data-min-hours type="number" step="1" value="3" /><small>h</small></label>
            <label><span>过程合并</span><input data-gap-hours type="number" step="1" value="4" /><small>h</small></label>
            <label><span>前后延展</span><input data-extend-hours type="number" step="1" value="3" /><small>h</small></label>
          </div>
          <div class="ff-metrics" data-event-summary></div>
          <article class="ff-card ff-chart" data-event-chart>运行场次识别后显示过程</article>
          <article class="ff-card ff-table-card"><table><thead><tr><th>场次</th><th>阶段</th><th>开始</th><th>历时</th><th>洪峰</th><th>NSE</th><th>KGE</th><th>峰值偏差</th></tr></thead><tbody data-event-table><tr><td colspan="8" class="ff-table-empty">暂无结果</td></tr></tbody></table></article>
        </section>

        <section class="ff-page" data-page="calibration">
          <div class="ff-page-title"><div><span>PARAMETER INFERENCE</span><h2>SCE-UA 参数率定</h2><p>异步搜索、实时进度与率定参数追踪。</p></div><div class="ff-inline-actions"><button type="button" data-cancel-calibration disabled>取消</button><button type="button" class="ff-primary" data-run-calibration>启动率定</button></div></div>
          <div class="ff-grid-2 ff-compact-controls">
            <label><span>最大评估次数</span><input data-maxn type="number" min="100" step="100" value="1000" /></label>
            <label><span>目标函数</span><select data-gof><option value="KGE">KGE</option><option value="NSE">NSE</option></select></label>
          </div>
          <label class="ff-check"><input data-flood-only type="checkbox" checked /><span>仅使用已识别洪水场次参与率定</span></label>
          <article class="ff-card ff-job">
            <div class="ff-card-head"><div><span>CALIBRATION JOB</span><h3 data-job-title>等待提交任务</h3></div><b data-job-value>0%</b></div>
            <div class="ff-progress"><i data-job-progress></i></div><p data-job-message>参数搜索未开始</p>
          </article>
          <article class="ff-card"><div class="ff-card-head"><div><span>PARAMETER SPACE</span><h3>模型参数</h3></div><small data-param-source>—</small></div><div class="ff-param-grid" data-params></div></article>
        </section>

        <section class="ff-page" data-page="sensitivity">
          <div class="ff-page-title"><div><span>SENSITIVITY MATRIX</span><h2>单参数扰动敏感性</h2><p>基于 KGE 响应曲线识别主控参数。</p></div><button type="button" class="ff-primary" data-run-sensitivity>运行分析</button></div>
          <div class="ff-grid-2 ff-compact-controls"><label><span>参数采样步数</span><input data-nstep type="number" min="5" max="101" step="2" value="21" /></label><div class="ff-rank-lead" data-sensitivity-lead>等待分析</div></div>
          <article class="ff-card ff-chart" data-sensitivity-chart>运行后显示参数响应曲线</article>
          <div class="ff-sensitivity-ranks" data-sensitivity-ranks></div>
        </section>

        <section class="ff-page" data-page="history">
          <div class="ff-page-title"><div><span>HINDCAST LAB</span><h2>历史洪水模拟</h2><p>率定参数自动回放，逐时检验降雨—径流响应。</p></div><button type="button" class="ff-primary" data-run-history>运行模拟</button></div>
          <div class="ff-metrics" data-history-metrics></div>
          <article class="ff-card ff-chart" data-history-chart>运行历史模拟后显示过程</article>
          <article class="ff-card ff-table-card"><table><thead><tr><th>场次</th><th>阶段</th><th>开始</th><th>历时</th><th>洪峰</th><th>NSE</th><th>KGE</th><th>峰值偏差</th></tr></thead><tbody data-history-table><tr><td colspan="8" class="ff-table-empty">暂无结果</td></tr></tbody></table></article>
        </section>

        <section class="ff-page" data-page="forecast">
          <div class="ff-page-title"><div><span>NOWCAST ENGINE</span><h2>未来洪水预报</h2><p>历史暖机与未来强迫双窗衔接，追踪预报洪峰。</p></div><button type="button" class="ff-primary" data-run-forecast>生成预报</button></div>
          <div class="ff-forecast-controls">
            <label><span>历史窗口终点</span><input data-history-end type="datetime-local" /></label>
            <label><span>预报起点 T₀</span><input data-forecast-start type="datetime-local" /></label>
            <label><span>预报终点</span><input data-forecast-end type="datetime-local" /></label>
          </div>
          <div class="ff-metrics" data-forecast-metrics></div>
          <article class="ff-card ff-chart" data-forecast-chart>设置预报窗口后生成过程</article>
          <div class="ff-forecast-strip" data-forecast-strip></div>
        </section>
      </div>
    </div>
    <div class="ff-toast" data-toast hidden></div>`;
}

export function bindFlashFloodPlugin(
  map: MapLibreMap,
  beforeOpen?: () => void,
  resizeMap?: () => void,
  afterClose?: () => void,
): FlashFloodPlugin {
  const client = createFlashFloodClient({ baseUrl: `${import.meta.env.BASE_URL}api` });
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-btn flash-flood-button";
  button.dataset.tip = "FLASHFLOOD 山洪预报";
  button.ariaLabel = "打开 FLASHFLOOD 山洪预报";
  button.ariaPressed = "false";
  const icon = document.createElement("img");
  icon.src = `${import.meta.env.BASE_URL}icons/flash-flood.svg`;
  icon.alt = "";
  button.append(icon);
  document.getElementById("draw-geometry")?.after(button);

  const panel = document.createElement("section");
  panel.className = "flash-flood-workspace";
  panel.setAttribute("aria-label", "FLASHFLOOD 山洪预报");
  panel.hidden = true;
  panel.innerHTML = panelTemplate();
  document.querySelector(".map-stage")?.append(panel);

  const sitePane = document.createElement("section");
  sitePane.id = "ff-sites";
  sitePane.className = "ff-sites";
  sitePane.innerHTML = `
    <div class="section-title"><strong>站点目录</strong><small data-site-count></small></div>
    <input data-site-filter type="search" placeholder="搜索站点" aria-label="搜索站点" />
    <div class="ff-site-groups" data-site-groups></div>`;
  document.getElementById("sidebar")?.prepend(sitePane);

  const siteSelect = byData<HTMLSelectElement>(panel, "site");
  const modelSelect = byData<HTMLSelectElement>(panel, "model");
  const startInput = byData<HTMLInputElement>(panel, "start");
  const endInput = byData<HTMLInputElement>(panel, "end");
  const toast = byData<HTMLElement>(panel, "toast");
  let initialized = false;
  let initPromise: Promise<void> | null = null;
  let basinGeojson: FeatureCollection | null = null;
  let gaugedSites: string[] = [];
  let ungaugedSites: UngaugedSite[] = [];
  let forcing: ForcingPayload | undefined;
  let modelParams: ModelParam[] = [];
  let rulesCatalog: Awaited<ReturnType<typeof client.floodRules>> | null = null;
  let activeRequest: AbortController | null = null;
  let calibrationController: AbortController | null = null;
  let calibrationJobId: string | null = null;
  let toastTimer = 0;

  const showToast = (message: string, error = false) => {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.toggle("error", error);
    toast.hidden = false;
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 4200);
    setStatus(message, error);
  };

  const setServiceState = (label: string, live: boolean) => {
    byData(panel, "service-state").textContent = label;
    panel.classList.toggle("service-live", live);
  };

  const selectedSite = () => {
    if (!siteSelect.value) throw new Error("请先选择控制流域");
    return siteSelect.value;
  };
  const selectedModel = () => {
    if (!modelSelect.value) throw new Error("请先选择水文模型");
    return modelSelect.value;
  };
  const currentRules = (): EventRules => ({
    qMin: numberValue(panel, "q-min"),
    qPeak: numberValue(panel, "q-peak"),
    gapMaxHours: numberValue(panel, "gap-max"),
    minHours: numberValue(panel, "min-hours"),
    gapHours: numberValue(panel, "gap-hours"),
    extendHours: numberValue(panel, "extend-hours"),
  });
  const forcingOverride = () => forcing ? { forcing } : {};

  const markActiveSite = (site: string) => {
    sitePane.querySelectorAll<HTMLButtonElement>("[data-site-id]").forEach((item) => {
      item.classList.toggle("active", item.dataset.siteId === site);
    });
  };

  const renderSiteList = () => {
    const query = byData<HTMLInputElement>(sitePane, "site-filter").value.trim().toLowerCase();
    const match = (name: string) => !query || name.toLowerCase().includes(query);
    const { national, regional } = groupGaugedSites(gaugedSites.filter(match));
    const ungauged = ungaugedSites.filter((site) => match(site.name) || match(site.site ?? ""));
    const group = (title: string, rows: string) => rows
      ? `<article class="ff-site-group"><h3>${title}</h3>${rows}</article>`
      : "";
    const gaugedBtn = (site: string, tier: string) =>
      `<button type="button" class="ff-site-btn${siteSelect.value === site ? " active" : ""}" data-site-id="${escapeHtml(site)}" data-tier="${tier}">${escapeHtml(site)}</button>`;
    byData(sitePane, "site-count").textContent =
      `${gaugedSites.length} 有资料 · ${ungaugedSites.length} 无资料`;
    byData(sitePane, "site-groups").innerHTML = [
      group(`国家站 · ${national.length}`, national.map((site) => gaugedBtn(site, "national")).join("")),
      group(`中小河流站 · ${regional.length}`, regional.map((site) => gaugedBtn(site, "regional")).join("")),
      group(`无资料站 · ${ungauged.length}`, ungauged.map((site) => {
        const key = site.site ?? `ungauged:${site.id}`;
        return `<button type="button" class="ff-site-btn${siteSelect.value === key ? " active" : ""}" data-site-id="${escapeHtml(key)}" data-tier="ungauged" data-lon="${site.lon ?? ""}" data-lat="${site.lat ?? ""}">${escapeHtml(site.name)}</button>`;
      }).join("")),
    ].join("") || `<p class="ff-table-empty">无匹配站点</p>`;
  };

  const run = async <T,>(label: string, action: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    activeRequest?.abort();
    const controller = new AbortController();
    activeRequest = controller;
    panel.classList.add("busy");
    showToast(`${label}…`);
    try {
      const result = await action(controller.signal);
      showToast(`${label}完成`);
      return result;
    } catch (error) {
      if ((error as { name?: string }).name !== "AbortError") {
        showToast(error instanceof Error ? error.message : String(error), true);
      }
      return undefined;
    } finally {
      if (activeRequest === controller) activeRequest = null;
      panel.classList.remove("busy");
    }
  };

  const applyCatalogRules = () => {
    if (!rulesCatalog) return;
    const source = rulesCatalog.sites[siteSelect.value] ?? rulesCatalog.default;
    byData<HTMLInputElement>(panel, "q-min").value = String(source.Q_min);
    byData<HTMLInputElement>(panel, "q-peak").value = String(source.Q_peak);
    byData<HTMLInputElement>(panel, "gap-max").value = String((source.gap_max_days ?? 2) * 24);
  };

  const renderParams = (source = "模型默认参数") => {
    byData(panel, "param-source").textContent = source;
    const host = byData(panel, "params");
    host.innerHTML = modelParams.length ? modelParams.map((param) => `
      <label title="${escapeHtml(param.description ?? param.name)}">
        <span>${escapeHtml(param.label ?? param.name)}<small>${escapeHtml(param.unit ?? "")}</small></span>
        <b>${formatMetric(param.value, 4)}</b>
        <i style="--value:${Math.max(0, Math.min(100, (param.value - param.min) / Math.max(1e-12, param.max - param.min) * 100))}%"></i>
        <em>${formatMetric(param.min, 3)} — ${formatMetric(param.max, 3)}</em>
      </label>`).join("") : '<div class="ff-empty">暂无参数</div>';
  };

  const loadSite = async () => {
    if (!siteSelect.value || !modelSelect.value) return;
    const [meta, params] = await Promise.all([
      client.forcing(siteSelect.value),
      client.params(siteSelect.value, modelSelect.value),
    ]);
    modelParams = params.params;
    const periodStart = apiDate(meta.period.start);
    const periodEnd = apiDate(meta.period.end);
    const forecastStartDate = new Date(periodEnd);
    forecastStartDate.setUTCFullYear(forecastStartDate.getUTCFullYear() - 1);
    if (forecastStartDate <= periodStart) {
      forecastStartDate.setTime(periodStart.getTime() + (periodEnd.getTime() - periodStart.getTime()) * 0.7);
    }
    const historyEndDate = new Date(forecastStartDate.getTime() - 3_600_000);
    startInput.value = dateTimeValue(meta.period.start);
    endInput.value = dateTimeValue(historyEndDate.toISOString());
    const historyEnd = byData<HTMLInputElement>(panel, "history-end");
    const forecastStart = byData<HTMLInputElement>(panel, "forecast-start");
    const forecastEnd = byData<HTMLInputElement>(panel, "forecast-end");
    historyEnd.value = dateTimeValue(historyEndDate.toISOString());
    forecastStart.value = dateTimeValue(forecastStartDate.toISOString());
    forecastEnd.value = dateTimeValue(meta.period.end);
    applyCatalogRules();
    const calibrated = params.calibration_hint?.has_calibrated;
    byData(panel, "data-stats").innerHTML = `
      <article><span>监测流域</span><b>${siteSelect.options.length}</b><small>SpatialHydro catalog</small></article>
      <article><span>流域面积</span><b>${formatMetric(meta.area_km2, 1)}</b><small>km²</small></article>
      <article><span>时间步数</span><b>${meta.period.n.toLocaleString("zh-CN")}</b><small>hourly forcing</small></article>
      <article><span>参数来源</span><b>${calibrated ? "已率定" : "默认"}</b><small>${escapeHtml(params.source ?? "model state")}</small></article>`;
    byData(panel, "window-line").innerHTML = `<b>${escapeHtml(meta.period.start.replace("T", " "))}</b><i></i><b>${escapeHtml(meta.period.end.replace("T", " "))}</b><span>${meta.period.n.toLocaleString("zh-CN")} 个时间步</span>`;
    byData(panel, "source-detail").innerHTML = `<dt>端点</dt><dd>/api/model</dd><dt>站点</dt><dd>${escapeHtml(meta.site)}</dd><dt>状态</dt><dd class="good">数据就绪</dd>`;
    renderParams(calibrated ? `站点率定 · maxn ${params.calibration_hint?.maxn ?? "—"}` : params.source ?? "模型默认参数");
    markActiveSite(siteSelect.value);
    focusSite();
  };

  const ensureBasinLayer = (geojson: FeatureCollection) => {
    const state = projectStore.getState();
    if (state.project.layers.some((layer) => layer.metadata.flashFloodRole === "basins")) return;
    const groupId = state.addGroup("FlashFlood");
    const layer = createVectorLayer("十堰山洪监测流域", geojson, state.project.layers);
    layer.groupId = groupId;
    layer.style = {
      ...layer.style,
      fillColor: "#0dcaf0",
      fillOpacity: 0.13,
      strokeColor: "#16d9c5",
      strokeWidth: 1.1,
    };
    layer.metadata = { ...layer.metadata, flashFloodRole: "basins", source: "SpatialHydro" };
    projectStore.getState().addLayer(layer);
  };

  const initialize = async (force = false) => {
    if (initPromise && !force) return initPromise;
    initPromise = (async () => {
      setServiceState("连接中", false);
      const [health, sites, catalog, catalogRules, basins, ungauged] = await Promise.all([
        client.health(), client.sites(), client.catalog(), client.floodRules(), client.basinsGeoJson(),
        client.ungaugedCatalog().catch(() => ({ sites: [] as UngaugedSite[] })),
      ]);
      rulesCatalog = catalogRules;
      basinGeojson = basins;
      gaugedSites = sites;
      ungaugedSites = ungauged.sites ?? [];
      const previousSite = siteSelect.value;
      const previousModel = modelSelect.value;
      siteSelect.replaceChildren(...sites.map((site) => new Option(site, site)));
      modelSelect.replaceChildren(...catalog.models.map((model) => new Option(`${model.label} · ${model.n_params}P`, model.id)));
      siteSelect.value = sites.includes(previousSite)
        ? previousSite
        : sites.includes("孤山")
          ? "孤山"
          : sites[0] ?? "";
      modelSelect.value = catalog.models.some((model) => model.id === previousModel) ? previousModel : catalog.default;
      ensureBasinLayer(basins);
      renderSiteList();
      await loadSite();
      setServiceState(health.status === "ok" ? "实时在线" : health.status, true);
      initialized = true;
    })().catch((error) => {
      setServiceState("连接失败", false);
      throw error;
    }).finally(() => { initPromise = null; });
    return initPromise;
  };

  function focusSite(): void {
    if (!basinGeojson || !siteSelect.value) return;
    const matches = basinGeojson.features.filter((feature) => siteName(feature) === siteSelect.value);
    const coordinates = matches.flatMap((feature) => coordinatesOf(feature.geometry));
    if (!coordinates.length) return;
    const bounds = coordinates.reduce((result, coordinate) => result.extend(coordinate as [number, number]), new LngLatBounds());
    map.fitBounds(bounds, { padding: 70, duration: 650 });
  }

  const renderSimulation = (result: SimulationResult, prefix: "event" | "history") => {
    if (prefix === "event") {
      const train = result.events.filter((event) => event.split === "TRAIN").length;
      const valid = result.events.length - train;
      byData(panel, "event-summary").innerHTML = `
        <article class="ff-metric good"><span>识别场次</span><b>${result.events.length}</b></article>
        <article class="ff-metric"><span>训练场次</span><b>${train}</b></article>
        <article class="ff-metric"><span>验证场次</span><b>${valid}</b></article>
        <article class="ff-metric"><span>总历时</span><b>${result.events.reduce((sum, event) => sum + event.duration_h, 0).toFixed(0)} h</b></article>`;
      renderHydrograph(byData(panel, "event-chart"), result.series, { events: result.events, title: `${result.site} · 洪水场次划分` });
      byData(panel, "event-table").innerHTML = eventsHtml(result.events);
    } else {
      byData(panel, "history-metrics").innerHTML = metricsHtml(result.metrics);
      renderHydrograph(byData(panel, "history-chart"), result.series, { events: result.events, title: `${result.site} · ${result.model_id ?? selectedModel()} 历史模拟` });
      byData(panel, "history-table").innerHTML = eventsHtml(result.events);
    }
  };

  const runEvents = async () => {
    const result = await run("洪水场次识别", (signal) => client.divideEvents({
      site: selectedSite(), t_start: startInput.value, t_end: endInput.value,
      ...eventRuleFields(currentRules()), ...forcingOverride(),
    }, signal));
    if (result) renderSimulation(result, "event");
  };

  const runHistory = async () => {
    const result = await run("历史洪水模拟", (signal) => client.simulate({
      site: selectedSite(), model_id: selectedModel(), t_start: startInput.value, t_end: endInput.value,
      ...eventRuleFields(currentRules()), ...forcingOverride(),
    }, signal));
    if (result) renderSimulation(result, "history");
  };

  const updateJob = (job: CalibrationJob) => {
    const maxn = job.maxn ?? numberValue(panel, "maxn");
    const done = job.status === "done";
    const progress = done ? 100 : Math.min(99, ((job.feval ?? job.iter ?? 0) / Math.max(1, maxn)) * 100);
    byData(panel, "job-title").textContent = `${job.status.toUpperCase()} · ${job.job_id.slice(0, 12)}`;
    byData(panel, "job-value").textContent = `${progress.toFixed(0)}%`;
    byData<HTMLElement>(panel, "job-progress").style.width = `${progress}%`;
    byData(panel, "job-message").textContent = `${job.message ?? "参数空间搜索中"}${job.best_gof == null ? "" : ` · best ${formatMetric(job.best_gof, 4)}`}`;
  };

  const runCalibration = async () => {
    const maxn = numberValue(panel, "maxn");
    if (maxn < 100) return showToast("最大评估次数不得小于 100，避免短率定污染站点参数", true);
    calibrationController?.abort();
    const controller = new AbortController();
    calibrationController = controller;
    byData<HTMLButtonElement>(panel, "run-calibration").disabled = true;
    byData<HTMLButtonElement>(panel, "cancel-calibration").disabled = false;
    try {
      const started = await client.startCalibration({
        site: selectedSite(), model_id: selectedModel(), t_start: startInput.value, t_end: endInput.value,
        maxn, fun_gof: byData<HTMLSelectElement>(panel, "gof").value,
        only_flood_events: byData<HTMLInputElement>(panel, "flood-only").checked,
        ...eventRuleFields(currentRules()), ...forcingOverride(),
      }, controller.signal);
      calibrationJobId = started.job_id;
      while (!controller.signal.aborted) {
        const job = await client.calibrationJob(started.job_id, controller.signal);
        updateJob(job);
        if (job.status === "done") {
          if (!job.result) throw new Error("率定完成但服务未返回结果");
          modelParams = Object.entries(job.result.params).map(([name, value]) => {
            const original = modelParams.find((param) => param.name === name);
            return { name, min: original?.min ?? value, max: original?.max ?? value, ...original, value };
          });
          renderParams(job.from_cache ? "率定缓存" : "SCE-UA 最优参数");
          renderSimulation(job.result, "history");
          showToast(job.from_cache ? "命中率定缓存" : "参数率定完成");
          return;
        }
        if (job.status === "failed") throw new Error(job.error ?? job.message ?? "率定失败");
        if (job.status === "cancelled") throw new DOMException("率定已取消", "AbortError");
        await wait(1500, controller.signal);
      }
    } catch (error) {
      if ((error as { name?: string }).name !== "AbortError") showToast(error instanceof Error ? error.message : String(error), true);
    } finally {
      calibrationController = null;
      calibrationJobId = null;
      byData<HTMLButtonElement>(panel, "run-calibration").disabled = false;
      byData<HTMLButtonElement>(panel, "cancel-calibration").disabled = true;
    }
  };

  const cancelCalibration = async () => {
    const jobId = calibrationJobId;
    calibrationController?.abort();
    if (jobId) await client.cancelCalibration(jobId).catch(() => undefined);
    showToast("已请求取消率定");
  };

  const renderSensitivity = (result: SensitivityResponse) => {
    renderSensitivityChart(byData(panel, "sensitivity-chart"), result);
    const curves = [...result.curves].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
    const top = curves[0];
    byData(panel, "sensitivity-lead").innerHTML = top ? `<span>主控参数</span><b>${escapeHtml(top.name)}</b><small>score ${formatMetric(top.score, 3)}</small>` : "无有效结果";
    byData(panel, "sensitivity-ranks").innerHTML = curves.map((curve, index) => `
      <article><b>${String(index + 1).padStart(2, "0")}</b><span>${escapeHtml(curve.name)}</span><i><em style="width:${Math.max(2, Math.min(100, (curve.score ?? 0) * 100))}%"></em></i><strong>${formatMetric(curve.score, 3)}</strong></article>`).join("");
  };

  const runSensitivity = async () => {
    const result = await run("敏感性分析", (signal) => client.sensitivity({
      site: selectedSite(), model_id: selectedModel(), t_start: startInput.value, t_end: endInput.value,
      nstep: numberValue(panel, "nstep"),
      ...(modelParams.length ? { params: Object.fromEntries(modelParams.map((param) => [param.name, param.value])) } : {}),
      ...forcingOverride(),
    }, signal));
    if (result) renderSensitivity(result);
  };

  const renderForecast = (result: ForecastResult) => {
    const merged = mergeForecastSeries(result.history.series, result.forecast.series);
    renderHydrograph(byData(panel, "forecast-chart"), merged.series, {
      forecastStart: merged.forecastStart,
      title: `${result.site} · ${result.model_id ?? selectedModel()} 未来洪水预报`,
    });
    byData(panel, "forecast-metrics").innerHTML = metricsHtml(result.forecast.metrics);
    const values = result.forecast.series.Q_sim.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const peak = values.length ? Math.max(...values) : null;
    const peakIndex = peak === null ? -1 : result.forecast.series.Q_sim.indexOf(peak);
    byData(panel, "forecast-strip").innerHTML = `
      <article><span>预报洪峰</span><b>${formatMetric(peak, 1)} <small>m³/s</small></b></article>
      <article><span>峰现时间</span><b>${escapeHtml(peakIndex >= 0 ? result.forecast.series.time[peakIndex]?.replace("T", " ").slice(0, 16) : "—")}</b></article>
      <article><span>参数来源</span><b>${escapeHtml(result.param_source ?? "自动")}</b></article>`;
  };

  const runForecast = async () => {
    const historyEnd = byData<HTMLInputElement>(panel, "history-end").value;
    const forecastStart = byData<HTMLInputElement>(panel, "forecast-start").value;
    const forecastEnd = byData<HTMLInputElement>(panel, "forecast-end").value;
    const result = await run("未来洪水预报", (signal) => {
      const localForcing = forcing ? {
        history_forcing: sliceForcingByWindow(forcing, startInput.value, historyEnd),
        forecast_forcing: sliceForcingByWindow(forcing, forecastStart, forecastEnd),
      } : {};
      return client.forecast({
        site: selectedSite(), model_id: selectedModel(), history_start: startInput.value,
        history_end: historyEnd, forecast_start: forecastStart, forecast_end: forecastEnd,
        ...eventRuleFields(currentRules()), ...localForcing,
      }, signal);
    });
    if (result) renderForecast(result);
  };

  const loadCsv = async (file: File) => {
    forcing = parseForcingCsv(await file.text());
    byData(panel, "local-badge").textContent = `${forcing.P.length.toLocaleString("zh-CN")} 行`;
    byData<HTMLButtonElement>(panel, "clear-csv").disabled = false;
    showToast(`已载入 ${file.name}`);
  };

  const switchTab = (name: string) => {
    panel.querySelectorAll<HTMLElement>("[data-tab]").forEach((item) => item.classList.toggle("active", item.dataset.tab === name));
    panel.querySelectorAll<HTMLElement>("[data-page]").forEach((item) => item.classList.toggle("active", item.dataset.page === name));
  };

  panel.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((item) => item.addEventListener("click", () => switchTab(item.dataset.tab!)));
  byData(panel, "close").addEventListener("click", close);
  byData(panel, "focus").addEventListener("click", focusSite);
  byData(panel, "refresh").addEventListener("click", () => void run("刷新数据链", () => initialize(true)));
  siteSelect.addEventListener("change", () => {
    markActiveSite(siteSelect.value);
    void run("加载流域数据", () => loadSite());
  });
  byData<HTMLInputElement>(sitePane, "site-filter").addEventListener("input", renderSiteList);
  sitePane.addEventListener("click", (event) => {
    const item = (event.target as Element).closest<HTMLButtonElement>("[data-site-id]");
    const id = item?.dataset.siteId;
    if (!id) return;
    if (id.startsWith("ungauged:")) {
      markActiveSite(id);
      const lon = Number(item.dataset.lon);
      const lat = Number(item.dataset.lat);
      if (Number.isFinite(lon) && Number.isFinite(lat)) map.flyTo({ center: [lon, lat], zoom: 11, duration: 650 });
      showToast("无资料站无强迫序列，仅地图定位");
      return;
    }
    if (siteSelect.value === id) return focusSite();
    siteSelect.value = id;
    siteSelect.dispatchEvent(new Event("change"));
  });
  modelSelect.addEventListener("change", () => void run("加载模型参数", () => loadSite()));
  byData(panel, "run-events").addEventListener("click", () => void runEvents());
  byData(panel, "run-history").addEventListener("click", () => void runHistory());
  byData(panel, "run-sensitivity").addEventListener("click", () => void runSensitivity());
  byData(panel, "run-forecast").addEventListener("click", () => void runForecast());
  byData(panel, "run-calibration").addEventListener("click", () => void runCalibration());
  byData(panel, "cancel-calibration").addEventListener("click", () => void cancelCalibration());
  const csvFile = byData<HTMLInputElement>(panel, "csv-file");
  byData(panel, "load-csv").addEventListener("click", () => csvFile.click());
  csvFile.addEventListener("change", () => {
    const file = csvFile.files?.[0];
    if (file) void loadCsv(file).catch((error) => showToast(error instanceof Error ? error.message : String(error), true));
    csvFile.value = "";
  });
  byData(panel, "clear-csv").addEventListener("click", () => {
    forcing = undefined;
    byData(panel, "local-badge").textContent = "未载入";
    byData<HTMLButtonElement>(panel, "clear-csv").disabled = true;
    showToast("已恢复 SpatialHydro 站点数据");
  });

  function open(): void {
    beforeOpen?.();
    panel.hidden = false;
    document.body.classList.add("flash-flood-open");
    button.classList.add("active");
    button.ariaPressed = "true";
    button.ariaLabel = "关闭 FLASHFLOOD 山洪预报";
    requestAnimationFrame(() => resizeMap?.());
    if (!initialized) void initialize().catch((error) => showToast(error instanceof Error ? error.message : String(error), true));
  }

  function close(): boolean {
    if (panel.hidden) return false;
    activeRequest?.abort();
    panel.hidden = true;
    document.body.classList.remove("flash-flood-open");
    button.classList.remove("active");
    button.ariaPressed = "false";
    button.ariaLabel = "打开 FLASHFLOOD 山洪预报";
    afterClose?.();
    requestAnimationFrame(() => resizeMap?.());
    return true;
  }

  button.addEventListener("click", () => panel.hidden ? open() : close());

  return {
    close,
    dispose() {
      close();
      calibrationController?.abort();
      clearTimeout(toastTimer);
      button.remove();
      panel.remove();
      sitePane.remove();
    },
  };
}
