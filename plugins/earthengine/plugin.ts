import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import ee from "ee-auth";
import { annualEt } from "./PMLV2.ts";
import { EE_BODY_LIMIT, eeRoute, parseRunBody, stripMapToken } from "./run.ts";

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  if (/access_token|refresh_token/i.test(text)) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "internal" }));
    return;
  }
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(text);
}

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /token|credential|oauth/i.test(message) ? "Earth Engine 请求失败" : message;
}

function imageFromRequest(id: string, url: URL): ee.Image {
  if (url.searchParams.get("kind") !== "ImageCollection") return new ee.Image(id);

  const bands = url.searchParams.get("bands");
  const col = new ee.ImageCollection(id);
  if (url.searchParams.get("composite") !== "yearSum") {
    return (bands ? col.select(bands.split(",")) : col).mosaic();
  }

  return annualEt(ee, col, bands?.split(",")[0], Number(url.searchParams.get("year")));
}

function getMap(image: { getMap: Function }, vis: object): Promise<{ urlFormat?: string; mapid?: string }> {
  return new Promise((resolve, reject) => {
    image.getMap(vis, (a: unknown, b: unknown) => {
      const map = (a && typeof a === "object" && ("urlFormat" in a || "mapid" in a) ? a : null) as
        | { urlFormat?: string; mapid?: string }
        | null;
      const error = map ? (map === a ? b : a) : typeof a === "string" ? a : b || a;
      if (error) reject(error instanceof Error ? error : new Error(String(error)));
      else if (!map?.urlFormat && !map?.mapid) reject(new Error("Earth Engine 未返回瓦片 URL"));
      else resolve(map!);
    });
  });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > EE_BODY_LIMIT) {
      throw Object.assign(new Error("payload too large"), { status: 413 });
    }
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
      if (error) reject(error);
      else resolve(value);
    };
    try {
      const ret = ee.data.getAlgorithms((value: unknown, error?: unknown) => done(value, error));
      if (ret && typeof (ret as Promise<unknown>).then === "function") {
        void (ret as Promise<unknown>).then((value) => done(value), done);
      } else if (ret && typeof ret === "object") {
        done(ret);
      }
    } catch (error) {
      done(undefined, error);
    }
  });
}

function decodeExpression(expression: Record<string, unknown>): {
  getMap?: Function;
  getInfo?: Function;
  mosaic?: Function;
  name?: () => string;
} {
  const decoder = ee.Deserializer;
  if (decoder?.decodeCloudApi) return decoder.decodeCloudApi(expression);
  if (decoder?.decode) return decoder.decode(expression);
  throw new Error("Earth Engine 无法反序列化");
}

function urlFormatOf(map: { urlFormat?: string; mapid?: string }): string {
  if (map.urlFormat) return stripMapToken(map.urlFormat);
  if (map.mapid) return `https://earthengine.googleapis.com/map/${map.mapid}/{z}/{x}/{y}`;
  throw new Error("Earth Engine 未返回瓦片 URL");
}

const legacy = new Set(["geojson", "bands", "sample", "map"]);
const assetId = /^[A-Za-z0-9_./-]+$/;

async function handle(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const route = eeRoute(url.pathname);
  if (!route) return next();

  try {
    if (route === "run") {
      if (req.method !== "POST") return json(res, 405, { error: "method" });
      const body = parseRunBody(await readBody(req));
      await ee.Initialize();
      const obj = decodeExpression(body.expression);
      if (body.op === "getMap") {
        const image = typeof obj.getMap === "function" ? obj : typeof obj.mosaic === "function" ? obj.mosaic() : null;
        if (!image || typeof image.getMap !== "function") return json(res, 400, { error: "not an image" });
        return json(res, 200, { urlFormat: urlFormatOf(await getMap(image, body.vis)) });
      }
      if (typeof obj.getInfo !== "function") return json(res, 400, { error: "not computable" });
      return json(res, 200, obj.getInfo());
    }

    if (route === "ready") {
      if (req.method !== "GET") return json(res, 405, { error: "method" });
      await ee.Initialize();
      return json(res, 200, { ok: true, algorithms: await algorithms() });
    }

    if (!legacy.has(route) || req.method !== "GET") return next();

    const id = url.searchParams.get("id") ?? "";
    if (!assetId.test(id)) {
      return json(res, 400, { error: route === "sample" ? "invalid sample" : "invalid id" });
    }
    const box = ["west", "south", "east", "north"].map((key) => {
      const value = url.searchParams.get(key);
      return value == null || value === "" ? NaN : Number(value);
    });
    // ponytail: 只拉当前视野；无 bbox 不拉全球表
    if (route === "geojson" && !box.every(Number.isFinite)) {
      return json(res, 200, { type: "FeatureCollection", features: [] });
    }
    const lng = Number(url.searchParams.get("lng"));
    const lat = Number(url.searchParams.get("lat"));
    if (route === "sample" && (!Number.isFinite(lng) || !Number.isFinite(lat))) {
      return json(res, 400, { error: "invalid sample" });
    }

    await ee.Initialize();
    if (route === "geojson") {
      let table = new ee.FeatureCollection(id).filterBounds(new ee.Geometry.Rectangle(box, null, false));
      table = table.limit(url.searchParams.get("kind") === "Feature" ? 1 : 2000);
      return json(res, 200, table.getInfo());
    }
    if (route === "bands") {
      const image =
        url.searchParams.get("kind") === "ImageCollection" ? new ee.ImageCollection(id).first() : new ee.Image(id);
      const names = image.bandNames().getInfo();
      return json(res, 200, { bands: Array.isArray(names) ? names : [] });
    }
    if (route === "sample") {
      const scale = Number(url.searchParams.get("scale"));
      return json(
        res,
        200,
        imageFromRequest(id, url)
          .reduceRegion({
            reducer: ee.Reducer.first(),
            geometry: new ee.Geometry.Point([lng, lat]),
            scale: Number.isFinite(scale) && scale > 0 ? scale : 30,
            bestEffort: true,
          })
          .getInfo(),
      );
    }
    const vis: Record<string, unknown> = {};
    const min = url.searchParams.get("min");
    const max = url.searchParams.get("max");
    const palette = url.searchParams.get("palette");
    const bands = url.searchParams.get("bands");
    const gamma = url.searchParams.get("gamma");
    if (min != null) vis.min = Number(min);
    if (max != null) vis.max = Number(max);
    if (palette) vis.palette = palette.split(",");
    else if (gamma != null) vis.gamma = Number(gamma);
    if (bands) vis.bands = bands.split(",");
    return json(res, 200, { urlFormat: urlFormatOf(await getMap(imageFromRequest(id, url), vis)) });
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status);
    json(res, Number.isInteger(status) && status >= 400 && status < 600 ? status : 500, {
      error: publicError(error),
    });
  }
}

/** Node `ee-auth`：执行序列化计算图；不把 access token 送出去。 */
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
