import assert from "node:assert/strict";
import test from "node:test";
import config from "../vite.config";

test("production build preserves Earth Engine method parameters", () => {
  assert.equal(config.build?.minify, "esbuild");
  assert.equal(config.esbuild && "minifyIdentifiers" in config.esbuild, true);
  assert.equal(config.esbuild && config.esbuild.minifyIdentifiers, false);
});

test("only explicit SpatialHydro endpoints are proxied", () => {
  const routes = ["watershed", "model", "basins", "health"];
  for (const route of routes) {
    const path = `/project-demo/api/${route}`;
    const proxy = config.server?.proxy?.[path];
    assert.equal(typeof proxy === "object" && proxy.target, "http://127.0.0.1:8765");
    assert.equal(typeof proxy === "object" && proxy.rewrite?.(path), `/api/${route}`);
    assert.equal(config.preview?.proxy?.[path], proxy);
  }
  assert.equal(config.server?.proxy?.["/project-demo/api/projects"], undefined);
});
