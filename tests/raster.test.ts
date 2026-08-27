import assert from "node:assert/strict";
import test from "node:test";
import { pickRasterState, transparentMinimum } from "../src/raster";

test("pickRasterState keeps GeoLibre style fields", () => {
  const state = pickRasterState({
    mode: "single",
    bands: [1],
    colormap: "terrain",
    reversed: true,
    rescale: [[0, 100]],
    stretch: "log",
    gamma: 1.4,
    nodata: "auto",
    junk: 1,
  });
  assert.deepEqual(state, {
    mode: "single",
    bands: [1],
    colormap: "terrain",
    reversed: true,
    rescale: [[0, 100]],
    stretch: "log",
    gamma: 1.4,
    nodata: "auto",
  });
});

test("transparentMinimum follows the style checkbox", () => {
  assert.equal(transparentMinimum({ rescale: [[3000, 1e6]], transparentBelowMin: true }), 3000);
  assert.equal(transparentMinimum({ rescale: [[3000, 1e6]], transparentBelowMin: false }), undefined);
});

test("pickRasterState drops invalid values", () => {
  assert.deepEqual(pickRasterState({ colormap: "", gamma: 0, stretch: "foo", bands: [0] }), {});
  assert.equal(pickRasterState({ rescale: null }).rescale, null);
});
