import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/project-demo/",
  server: {
    host: "127.0.0.1",
    port: 5187,
    strictPort: true,
    allowedHosts: ["ecohydro.top"],
  },
  preview: { port: 4187, strictPort: true },
  worker: { format: "es" },
  resolve: {
    alias: {
      "@geolibre/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "@geolibre/map/headless": fileURLToPath(
        new URL("../../packages/map/src/headless.ts", import.meta.url),
      ),
    },
    dedupe: ["maplibre-gl"],
  },
});
