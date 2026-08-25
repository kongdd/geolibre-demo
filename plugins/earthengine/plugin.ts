import type { ServerResponse } from "node:http";
import type { Plugin } from "vite";
import ee from "ee-auth";
import { annualEt } from "./PMLV2.ts";

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function imageFromRequest(id: string, url: URL): ee.Image {
  if (url.searchParams.get("kind") !== "ImageCollection") return new ee.Image(id);

  const bands = url.searchParams.get("bands");
  const col = new ee.ImageCollection(id);
  if (url.searchParams.get("composite") !== "yearSum") {
    return (bands ? col.select(bands.split(",")) : col).mosaic();
  }

  return annualEt(col, bands?.split(",")[0], Number(url.searchParams.get("year")));
}

function getMap(image: ee.Image, vis: object): Promise<{ urlFormat?: string }> {
  return new Promise((resolve, reject) => {
    image.getMap(vis, (a: unknown, b: unknown) => {
      const map = (a && typeof a === "object" && ("urlFormat" in a || "mapid" in a) ? a : null) as { urlFormat?: string; mapid?: string } | null;
      const error = map ? (map === a ? b : a) : (typeof a === "string" ? a : b || a);
      if (error) reject(error instanceof Error ? error : new Error(String(error)));
      else if (!map?.urlFormat && !map?.mapid) reject(new Error("Earth Engine 未返回瓦片 URL"));
      else resolve(map!);
    });
  });
}

const routes = ["ready", "geojson", "bands", "sample", "map"] as const;
const assetId = /^[A-Za-z0-9_./-]+$/;

/** Node `ee-auth`：给浏览器发 mapid，不把 access token 送出去。 */
export function eeAuthPlugin(): Plugin {
  return {
    name: "ee-auth",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const route = routes.find((name) => url.pathname.endsWith(`/api/ee/${name}`));
        if (!route) return next();

        const id = url.searchParams.get("id") ?? "";
        if (route !== "ready" && !assetId.test(id)) {
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

        try {
          await ee.Initialize();
          if (route === "ready") return json(res, 200, { ok: true });
          if (route === "geojson") {
            let table = new ee.FeatureCollection(id).filterBounds(new ee.Geometry.Rectangle(box, null, false));
            table = table.limit(url.searchParams.get("kind") === "Feature" ? 1 : 2000);
            return json(res, 200, table.getInfo());
          }
          if (route === "bands") {
            const image =
              url.searchParams.get("kind") === "ImageCollection"
                ? new ee.ImageCollection(id).first()
                : new ee.Image(id);
            const names = image.bandNames().getInfo();
            return json(res, 200, { bands: Array.isArray(names) ? names : [] });
          }
          if (route === "sample") {
            const scale = Number(url.searchParams.get("scale"));
            return json(
              res,
              200,
              imageFromRequest(id, url).reduceRegion({
                reducer: ee.Reducer.first(),
                geometry: new ee.Geometry.Point([lng, lat]),
                scale: Number.isFinite(scale) && scale > 0 ? scale : 30,
                bestEffort: true,
              }).getInfo(),
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
          return json(res, 200, { urlFormat: (await getMap(imageFromRequest(id, url), vis)).urlFormat });
        } catch (error) {
          json(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  };
}
