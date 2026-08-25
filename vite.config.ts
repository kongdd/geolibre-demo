import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { eeAuthPlugin } from "./plugins/earthengine/plugin.ts";

const watershedProxy = {
  target: process.env.SPATIALHYDRO_API_URL ?? "http://127.0.0.1:8765",
  changeOrigin: true,
  rewrite: (path: string) => path.replace(/^\/project-demo\/api/, "/api"),
};

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/project-demo/",
  plugins: [eeAuthPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5187,
    strictPort: true,
    allowedHosts: ["ecohydro.top"],
    proxy: { "/project-demo/api": watershedProxy },
  },
  preview: {
    port: 4187,
    strictPort: true,
    proxy: { "/project-demo/api": watershedProxy },
  },
  worker: { format: "es" },
  resolve: {
    alias: {
      "@google/earthengine": fileURLToPath(
        new URL("./node_modules/@google/earthengine/build/browser.js", import.meta.url),
      ),
      "@geolibre/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "@geolibre/map/headless": fileURLToPath(
        new URL("../../packages/map/src/headless.ts", import.meta.url),
      ),
      "@geolibre/plugins/basemap-thumbnails": fileURLToPath(
        new URL("./plugins/basemap-thumbnails.ts", import.meta.url),
      ),
      "@geolibre/plugins/earthengine": fileURLToPath(
        new URL("./plugins/earthengine/index.ts", import.meta.url),
      ),
    },
    dedupe: ["maplibre-gl"],
  },
});
