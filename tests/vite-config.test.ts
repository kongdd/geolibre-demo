import assert from "node:assert/strict";
import test from "node:test";
import config from "../vite.config";

test("production build preserves Earth Engine method parameters", () => {
  assert.equal(config.build?.minify, "esbuild");
  assert.equal(config.esbuild && "minifyIdentifiers" in config.esbuild, true);
  assert.equal(config.esbuild && config.esbuild.minifyIdentifiers, false);
});
