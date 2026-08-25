export const EE_BODY_LIMIT = 256 * 1024;
export type RunOp = "getMap" | "getInfo";
export type RunRequest = {
  expression: Record<string, unknown>;
  op: RunOp;
  vis: Record<string, unknown>;
};

export function isCloudExpression(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  if (typeof rec.result === "string" && rec.values && typeof rec.values === "object") return true;
  return "functionInvocationValue" in rec || "constantValue" in rec || "valueReference" in rec;
}

function bad(message: string): Error {
  return Object.assign(new Error(message), { status: 400 });
}

function finite(value: unknown): boolean {
  return typeof value === "number" ? Number.isFinite(value) : false;
}

export function visParams(vis: unknown): Record<string, unknown> {
  if (!vis || typeof vis !== "object" || Array.isArray(vis)) return {};
  const src = vis as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (finite(src.min)) out.min = src.min;
  if (finite(src.max)) out.max = src.max;
  if (finite(src.gamma)) out.gamma = src.gamma;
  if (Array.isArray(src.bands)) out.bands = src.bands.map(String).slice(0, 3);
  if (Array.isArray(src.palette)) out.palette = src.palette.map(String).slice(0, 256);
  else if (typeof src.palette === "string") out.palette = src.palette.split(",").filter(Boolean).slice(0, 256);
  return out;
}

export function parseRunBody(raw: string): RunRequest {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw bad("invalid json");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw bad("invalid body");
  const rec = data as Record<string, unknown>;
  const op = rec.op === "getMap" || rec.op === "getInfo" ? rec.op : null;
  if (!op) throw bad("invalid op");
  let expr: unknown = rec.expression;
  if (typeof expr === "string") {
    try {
      expr = JSON.parse(expr);
    } catch {
      throw bad("invalid expression");
    }
  }
  if (!isCloudExpression(expr)) throw bad("invalid expression");
  return { expression: expr, op, vis: visParams(rec.vis) };
}

export function stripMapToken(url: string): string {
  const cut = url.indexOf("?");
  if (cut < 0) return url;
  const kept = url
    .slice(cut + 1)
    .split("&")
    .filter((part) => part && !/^token=/i.test(part));
  return kept.length ? `${url.slice(0, cut)}?${kept.join("&")}` : url.slice(0, cut);
}

export function eeRoute(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, "");
  const match = path.match(/^(?:\/project-demo)?\/api\/ee\/([^/]+)$/);
  return match?.[1] ?? null;
}
