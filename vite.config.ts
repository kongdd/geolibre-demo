import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { eeAuthPlugin } from "./plugins/earthengine/plugin.ts";
import { projectApiPlugin } from "./src/project/plugin.ts";

const spatialHydroProxy = {
  target: process.env.SPATIALHYDRO_API_URL ?? "http://127.0.0.1:8765",
  changeOrigin: true,
  rewrite: (path: string) => path.replace(/^\/project-demo/, ""),
};

// 精确列出 SpatialHydro 路由，避免截获 Project API。
const spatialHydroRoutes = {
  "/project-demo/api/watershed": spatialHydroProxy,
  "/project-demo/api/model": spatialHydroProxy,
  "/project-demo/api/basins": spatialHydroProxy,
  "/project-demo/api/health": spatialHydroProxy,
};

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/project-demo/",
  plugins: [eeAuthPlugin(), projectApiPlugin()],
  // Earth Engine 通过形参名解析位置参数；禁止压缩器改名。
  esbuild: { minifyIdentifiers: false },
  // /mnt/z 的 public/data 符号链接会生成无法清理的 CIFS 占位文件。
  build: { minify: "esbuild", emptyOutDir: false },
  server: {
    host: "127.0.0.1",
    port: 5187,
    strictPort: true,
    allowedHosts: ["ecohydro.top"],
    proxy: spatialHydroRoutes,
  },
  preview: {
    port: 4187,
    strictPort: true,
    proxy: spatialHydroRoutes,
  },
  worker: { format: "es" },
  resolve: {
    alias: {
      "@google/earthengine": fileURLToPath(
        new URL("./node_modules/@google/earthengine/build/browser.js", import.meta.url),
      ),
      "@geolibre/plugins/basemap-thumbnails": fileURLToPath(
        new URL("./plugins/basemap-thumbnails.ts", import.meta.url),
      ),
      "@geolibre/plugins/earthengine": fileURLToPath(
        new URL("./plugins/earthengine/index.ts", import.meta.url),
      ),
      "@geolibre/plugins/geometry": fileURLToPath(
        new URL("./plugins/geometry/index.ts", import.meta.url),
      ),
    },
    dedupe: ["maplibre-gl"],
  },
});
