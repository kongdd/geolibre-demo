import assert from "node:assert/strict";
import test from "node:test";
import config from "../vite.config";

test("production build preserves Earth Engine method parameters", () => {
  assert.equal(config.build?.minify, "esbuild");
  assert.equal(config.esbuild && "minifyIdentifiers" in config.esbuild, true);
  assert.equal(config.esbuild && config.esbuild.minifyIdentifiers, false);
});

test("only the watershed endpoint is proxied to SpatialHydro", () => {
  const proxy = config.server?.proxy?.["/project-demo/api/watershed"];
  assert.equal(typeof proxy === "object" && proxy.target, "http://127.0.0.1:8765");
  assert.equal(
    typeof proxy === "object" && proxy.rewrite?.("/project-demo/api/watershed"),
    "/api/watershed",
  );
  assert.equal(config.preview?.proxy?.["/project-demo/api/watershed"], proxy);
  assert.equal(config.server?.proxy?.["/project-demo/api/projects"], undefined);
});
