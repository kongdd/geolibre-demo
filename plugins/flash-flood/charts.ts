import type { EventRow, HydroSeries, SensitivityResponse } from "./client";

const NS = "http://www.w3.org/2000/svg";

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

export function sampledIndices(length: number, maximum = 640): number[] {
  if (length <= maximum) return Array.from({ length }, (_, index) => index);
  const stride = (length - 1) / (maximum - 1);
  return Array.from({ length: maximum }, (_, index) => Math.round(index * stride));
}

function finiteMax(values: Array<number | null | undefined>, fallback = 1): number {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finite.length ? Math.max(...finite, fallback) : fallback;
}

function pathFor(
  values: Array<number | null>,
  indices: number[],
  x: (index: number) => number,
  y: (value: number) => number,
): string {
  let path = "";
  let drawing = false;
  for (const index of indices) {
    const value = values[index];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      drawing = false;
      continue;
    }
    path += `${drawing ? "L" : "M"}${x(index).toFixed(2)},${y(value).toFixed(2)}`;
    drawing = true;
  }
  return path;
}

function axisLabel(value: number): string {
  return Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(value < 10 ? 1 : 0);
}

export function renderHydrograph(
  host: HTMLElement,
  series: HydroSeries,
  options: { events?: EventRow[]; title?: string; forecastStart?: number } = {},
): void {
  host.replaceChildren();
  const width = 900;
  const height = 360;
  const pad = { left: 62, right: 26, top: 32, bottom: 42 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const n = Math.max(series.time.length, series.Q_obs.length, series.Q_sim.length);
  if (!n) {
    host.textContent = "暂无过程数据";
    host.classList.add("ff-empty");
    return;
  }
  host.classList.remove("ff-empty");
  const maxQ = finiteMax([...series.Q_obs, ...series.Q_sim]) * 1.08;
  const maxP = finiteMax(series.P) * 1.18;
  const x = (index: number) => pad.left + (index / Math.max(1, n - 1)) * innerWidth;
  const y = (value: number) => pad.top + innerHeight - (value / maxQ) * innerHeight;
  const svg = svgElement("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" });
  svg.classList.add("ff-chart-svg");
  const defs = svgElement("defs");
  const gradient = svgElement("linearGradient", { id: "ff-area", x1: 0, y1: 0, x2: 0, y2: 1 });
  gradient.append(
    Object.assign(svgElement("stop", { offset: "0%", "stop-color": "#17e8c1", "stop-opacity": 0.3 })),
    Object.assign(svgElement("stop", { offset: "100%", "stop-color": "#17e8c1", "stop-opacity": 0 })),
  );
  defs.append(gradient);
  svg.append(defs);

  for (let tick = 0; tick <= 4; tick += 1) {
    const yy = pad.top + (tick / 4) * innerHeight;
    svg.append(svgElement("line", { x1: pad.left, x2: width - pad.right, y1: yy, y2: yy, class: "ff-grid" }));
    const label = svgElement("text", { x: pad.left - 12, y: yy + 4, "text-anchor": "end", class: "ff-axis" });
    label.textContent = axisLabel(maxQ * (1 - tick / 4));
    svg.append(label);
  }

  const displayIndex = (sourceIndex: number): number => {
    const source = series.source_idx;
    if (!source?.length) return Math.max(0, Math.min(n - 1, sourceIndex));
    let low = 0;
    let high = source.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((source[middle] ?? 0) < sourceIndex) low = middle + 1;
      else high = middle;
    }
    return Math.max(0, Math.min(n - 1, low));
  };
  for (const event of options.events ?? []) {
    const start = displayIndex(event.start_idx);
    const end = displayIndex(event.end_idx);
    svg.append(svgElement("rect", {
      x: x(start), y: pad.top, width: Math.max(2, x(end) - x(start)), height: innerHeight,
      class: event.split === "TRAIN" ? "ff-event-train" : "ff-event-valid",
    }));
  }

  const rainWidth = Math.max(1, innerWidth / Math.max(n, 1));
  for (const index of sampledIndices(series.P.length, 360)) {
    const value = series.P[index] ?? 0;
    if (value <= 0) continue;
    svg.append(svgElement("rect", {
      x: x(index) - rainWidth / 2,
      y: pad.top,
      width: rainWidth,
      height: Math.max(1, (value / maxP) * innerHeight * 0.28),
      class: "ff-rain-bar",
    }));
  }

  if (typeof options.forecastStart === "number") {
    const lineX = x(options.forecastStart);
    svg.append(svgElement("line", { x1: lineX, x2: lineX, y1: pad.top, y2: height - pad.bottom, class: "ff-forecast-line" }));
    const label = svgElement("text", { x: lineX + 6, y: pad.top + 14, class: "ff-forecast-label" });
    label.textContent = "T₀";
    svg.append(label);
  }

  const indices = sampledIndices(n);
  const simulated = pathFor(series.Q_sim, indices, x, y);
  if (simulated) {
    const area = `${simulated}L${x(n - 1)},${height - pad.bottom}L${x(0)},${height - pad.bottom}Z`;
    svg.append(svgElement("path", { d: area, fill: "url(#ff-area)" }));
    svg.append(svgElement("path", { d: simulated, class: "ff-line-sim" }));
  }
  const observed = pathFor(series.Q_obs, indices, x, y);
  if (observed) svg.append(svgElement("path", { d: observed, class: "ff-line-obs" }));

  const title = svgElement("text", { x: pad.left, y: 18, class: "ff-chart-title" });
  title.textContent = options.title ?? "降雨—径流过程";
  svg.append(title);
  const unit = svgElement("text", { x: 10, y: pad.top - 8, class: "ff-axis" });
  unit.textContent = "m³/s";
  svg.append(unit);
  const first = series.time[0] ?? "";
  const last = series.time[n - 1] ?? "";
  for (const [xx, value, anchor] of [[pad.left, first, "start"], [width - pad.right, last, "end"]] as const) {
    const label = svgElement("text", { x: xx, y: height - 14, "text-anchor": anchor, class: "ff-axis" });
    label.textContent = value.replace("T", " ").slice(0, 16);
    svg.append(label);
  }
  host.append(svg);
}

export function renderSensitivityChart(host: HTMLElement, result: SensitivityResponse): void {
  host.replaceChildren();
  const width = 900;
  const height = 360;
  const pad = { left: 56, right: 30, top: 34, bottom: 42 };
  const curves = [...result.curves]
    .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
    .slice(0, 8);
  const values = curves.flatMap((curve) => curve.points.map((point) => point.gof));
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!finite.length) {
    host.textContent = "敏感性结果无有效 KGE";
    host.classList.add("ff-empty");
    return;
  }
  host.classList.remove("ff-empty");
  const minY = Math.min(...finite, -1);
  const maxY = Math.max(...finite, 1);
  const spanY = Math.max(0.01, maxY - minY);
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const colors = ["#17e8c1", "#2dd4ff", "#a78bfa", "#ffbd59", "#fb7185", "#7dd3fc", "#c4f54b", "#f472b6"];
  const svg = svgElement("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" });
  svg.classList.add("ff-chart-svg");
  for (let tick = 0; tick <= 4; tick += 1) {
    const yy = pad.top + tick / 4 * innerHeight;
    svg.append(svgElement("line", { x1: pad.left, x2: width - pad.right, y1: yy, y2: yy, class: "ff-grid" }));
    const label = svgElement("text", { x: pad.left - 10, y: yy + 4, "text-anchor": "end", class: "ff-axis" });
    label.textContent = (maxY - tick / 4 * spanY).toFixed(2);
    svg.append(label);
  }
  curves.forEach((curve, curveIndex) => {
    const valid = curve.points.filter((point) => point.gof !== null && Number.isFinite(point.gof));
    if (!valid.length) return;
    const minX = Math.min(...valid.map((point) => point.theta));
    const maxX = Math.max(...valid.map((point) => point.theta));
    const spanX = Math.max(1e-12, maxX - minX);
    const d = valid.map((point, index) => {
      const xx = pad.left + (point.theta - minX) / spanX * innerWidth;
      const yy = pad.top + (maxY - point.gof!) / spanY * innerHeight;
      return `${index ? "L" : "M"}${xx.toFixed(2)},${yy.toFixed(2)}`;
    }).join("");
    svg.append(svgElement("path", { d, fill: "none", stroke: colors[curveIndex], "stroke-width": 2 }));
    const label = svgElement("text", { x: width - pad.right - curveIndex * 96, y: 18, "text-anchor": "end", fill: colors[curveIndex], class: "ff-legend" });
    label.textContent = curve.name;
    svg.append(label);
  });
  host.append(svg);
}

export function mergeForecastSeries(history: HydroSeries, forecast: HydroSeries): { series: HydroSeries; forecastStart: number } {
  const forecastStart = history.time.length;
  return {
    forecastStart,
    series: {
      time: [...history.time, ...forecast.time],
      P: [...history.P, ...forecast.P],
      PET: [...(history.PET ?? []), ...(forecast.PET ?? [])],
      Q_obs: [...history.Q_obs, ...forecast.Q_obs],
      Q_sim: [...history.Q_sim, ...forecast.Q_sim],
    },
  };
}
