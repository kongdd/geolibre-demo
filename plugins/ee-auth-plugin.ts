import type { ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { ee } from "ee-auth";

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function getMap(image: ee.Image, vis: object): Promise<{ urlFormat?: string }> {
  return new Promise((resolve, reject) => {
    image.getMap(vis, (a: unknown, b: unknown) => {
      const map = a && typeof a === "object" && "urlFormat" in a ? a : b;
      const error = map === a ? b : a;
      if (error) reject(error);
      else resolve((map ?? {}) as { urlFormat?: string });
    });
  });
}

function getInfo(obj: ee.ComputedObject): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const done = (error: unknown, result?: unknown) => {
      if (error) reject(error);
      else resolve(result);
    };
    try {
      const ret = obj.getInfo((a: unknown, b: unknown) => {
        const result = a && typeof a === "object" ? a : b;
        done(result === a ? b : a, result);
      });
      if (ret && typeof (ret as Promise<unknown>).then === "function") {
        void (ret as Promise<unknown>).then((result: unknown) => done(null, result), done);
      }
    } catch (error) {
      done(error);
    }
  });
}

/** Node `ee-auth`：给浏览器发 mapid，不把 access token 送出去。 */
export function eeAuthPlugin(): Plugin {
  let boot: Promise<void> | null = null;
  const ready = () => {
    if (!boot) {
      boot = ee.Initialize().catch((error: unknown) => {
        boot = null;
        throw error;
      });
    }
    return boot;
  };

  return {
    name: "ee-auth",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname.endsWith("/api/ee/ready")) {
          try {
            await ready();
            json(res, 200, { ok: true });
          } catch (error) {
            json(res, 500, { error: error instanceof Error ? error.message : String(error) });
          }
          return;
        }
        if (url.pathname.endsWith("/api/ee/geojson")) {
          const id = url.searchParams.get("id") ?? "";
          if (!/^[A-Za-z0-9_./-]+$/.test(id)) return json(res, 400, { error: "invalid id" });
          const west = url.searchParams.get("west");
          const south = url.searchParams.get("south");
          const east = url.searchParams.get("east");
          const north = url.searchParams.get("north");
          const box = [west, south, east, north].map((value) => (value == null || value === "" ? NaN : Number(value)));
          // ponytail: 只拉当前视野；无 bbox 不拉全球表
          if (!box.every(Number.isFinite)) return json(res, 200, { type: "FeatureCollection", features: [] });
          try {
            await ready();
            const rect = new ee.Geometry.Rectangle(box as number[], null, false);
            let table = new ee.FeatureCollection(id).filterBounds(rect);
            table = table.limit(url.searchParams.get("kind") === "Feature" ? 1 : 2000);
            json(res, 200, await getInfo(table));
          } catch (error) {
            json(res, 500, { error: error instanceof Error ? error.message : String(error) });
          }
          return;
        }
        if (url.pathname.endsWith("/api/ee/bands")) {
          const id = url.searchParams.get("id") ?? "";
          if (!/^[A-Za-z0-9_./-]+$/.test(id)) return json(res, 400, { error: "invalid id" });
          try {
            await ready();
            const image =
              url.searchParams.get("kind") === "ImageCollection"
                ? new ee.ImageCollection(id).first()
                : new ee.Image(id);
            const names = await getInfo(image.bandNames());
            json(res, 200, { bands: Array.isArray(names) ? names : [] });
          } catch (error) {
            json(res, 500, { error: error instanceof Error ? error.message : String(error) });
          }
          return;
        }
        if (!url.pathname.endsWith("/api/ee/map")) return next();
        const id = url.searchParams.get("id") ?? "";
        if (!/^[A-Za-z0-9_./-]+$/.test(id)) return json(res, 400, { error: "invalid id" });
        try {
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
          await ready();
          const image =
            url.searchParams.get("kind") === "ImageCollection"
              ? new ee.ImageCollection(id).mosaic()
              : new ee.Image(id);
          json(res, 200, { urlFormat: (await getMap(image, vis)).urlFormat });
        } catch (error) {
          json(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  };
}
