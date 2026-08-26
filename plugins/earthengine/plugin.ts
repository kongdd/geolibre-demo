import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import ee from "ee-auth";
import {
  EE_BODY_LIMIT,
  EE_RESULT_LIMIT,
  EE_RUN_CONCURRENCY,
  EE_RUN_TIMEOUT,
  eeRoute,
  parseRunBody,
  stripMapToken,
} from "./run.ts";

let activeRuns = 0;
const requests = new Map<string, { minute: number; count: number }>();

function json(res: ServerResponse, status: number, body: unknown): void {
  let text = JSON.stringify(body);
  if (/access_token|refresh_token/i.test(text)) {
    status = 500;
    text = JSON.stringify({ error: "internal" });
  } else if (Buffer.byteLength(text) > EE_RESULT_LIMIT) {
    status = 413;
    text = JSON.stringify({ error: "result too large" });
  }
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(text);
}

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /token|credential|oauth/i.test(message) ? "Earth Engine 请求失败" : message;
}

function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  return String(Array.isArray(forwarded) ? forwarded[0] : forwarded ?? req.socket.remoteAddress ?? "unknown")
    .split(",")[0]!
    .trim();
}

function allowRequest(req: IncomingMessage): boolean {
  const minute = Math.floor(Date.now() / 60_000);
  const key = clientIp(req);
  const hit = requests.get(key);
  if (!hit || hit.minute !== minute) {
    // ponytail: 单进程限流；多实例部署时移到网关。
    if (requests.size > 10_000) requests.clear();
    requests.set(key, { minute, count: 1 });
    return true;
  }
  return ++hit.count <= 60;
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  const forwarded = req.headers["x-forwarded-host"];
  const host = String(Array.isArray(forwarded) ? forwarded[0] : forwarded ?? req.headers.host ?? "")
    .split(",")[0]!
    .trim();
  try {
    return typeof origin === "string" && new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > EE_BODY_LIMIT) throw Object.assign(new Error("payload too large"), { status: 413 });
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function algorithms(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (value: unknown, error?: unknown) => {
      if (settled) return;
      settled = true;
      error ? reject(error) : resolve(value);
    };
    try {
      const ret = ee.data.getAlgorithms((value: unknown, error?: unknown) => done(value, error));
      if (ret && typeof (ret as Promise<unknown>).then === "function") {
        void (ret as Promise<unknown>).then((value) => done(value), (error) => done(undefined, error));
      } else if (ret && typeof ret === "object") {
        done(ret);
      }
    } catch (error) {
      done(undefined, error);
    }
  });
}

function terminal(obj: object, method: "getInfo" | "getMap", arg?: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (value: unknown, error?: unknown) => {
      if (settled) return;
      settled = true;
      error ? reject(error) : resolve(value);
    };
    try {
      const fn = (obj as Record<string, Function>)[method];
      const callback = (a: unknown, b?: unknown) => {
        if (method === "getInfo") return done(a, b);
        const map = a && typeof a === "object" && ("urlFormat" in a || "mapid" in a) ? a : b;
        done(map, map === a ? b : a);
      };
      const ret = method === "getMap" ? fn!.call(obj, arg ?? {}, callback) : fn!.call(obj, callback);
      if (ret && typeof (ret as Promise<unknown>).then === "function") {
        void (ret as Promise<unknown>).then((value) => done(value), (error) => done(undefined, error));
      } else if (ret !== undefined) {
        done(ret);
      }
    } catch (error) {
      done(undefined, error);
    }
  });
}

async function limited<T>(run: () => Promise<T>): Promise<T> {
  if (activeRuns >= EE_RUN_CONCURRENCY) throw Object.assign(new Error("busy"), { status: 429 });
  activeRuns++;
  const task = run().finally(() => activeRuns--);
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error("timeout"), { status: 504 })),
      EE_RUN_TIMEOUT,
    );
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

function decodeExpression(expression: Record<string, unknown>): {
  getMap?: Function;
  getInfo?: Function;
  mosaic?: Function;
} {
  const decoder = ee.Deserializer;
  if (decoder?.decodeCloudApi) return decoder.decodeCloudApi(expression);
  if (decoder?.decode) return decoder.decode(expression);
  throw new Error("Earth Engine 无法反序列化");
}

function urlFormatOf(map: unknown): string {
  const value = map as { urlFormat?: string; mapid?: string };
  if (value.urlFormat) return stripMapToken(value.urlFormat);
  if (value.mapid) return `https://earthengine.googleapis.com/map/${value.mapid}/{z}/{x}/{y}`;
  throw new Error("Earth Engine 未返回瓦片 URL");
}

async function handle(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
  const route = eeRoute(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
  if (!route) return next();
  try {
    if (route === "ready") {
      if (req.method !== "GET") return json(res, 405, { error: "method" });
      await ee.Initialize();
      res.setHeader("Cache-Control", "private, max-age=3600");
      return json(res, 200, { ok: true, algorithms: await algorithms() });
    }
    if (req.method !== "POST") return json(res, 405, { error: "method" });
    if (!sameOrigin(req)) return json(res, 403, { error: "origin" });
    if (!allowRequest(req)) return json(res, 429, { error: "rate limit" });

    const body = parseRunBody(await readBody(req));
    await ee.Initialize();
    const obj = decodeExpression(body.expression);
    if (body.op === "getMap") {
      const image = obj.getMap ? obj : obj.mosaic?.();
      if (!image?.getMap) return json(res, 400, { error: "not an image" });
      const map = await limited(() => terminal(image, "getMap", body.vis));
      return json(res, 200, { urlFormat: urlFormatOf(map) });
    }
    if (!obj.getInfo) return json(res, 400, { error: "not computable" });
    return json(res, 200, await limited(() => terminal(obj, "getInfo")));
  } catch (error) {
    console.error("[ee]", error);
    const status = Number((error as { status?: unknown })?.status);
    json(res, Number.isInteger(status) && status >= 400 && status < 600 ? status : 500, {
      error: publicError(error),
    });
  }
}

/** Node `ee-auth`：匿名用户共享受限的服务端 GEE 身份。 */
export function eeAuthPlugin(): Plugin {
  const attach = (server: { middlewares: { use: (fn: typeof handle) => void } }) => {
    server.middlewares.use(handle);
  };
  return {
    name: "ee-auth",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
