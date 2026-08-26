import assert from "node:assert/strict";
import test from "node:test";
import {
  eeRoute,
  isCloudExpression,
  isGeeRaster,
  parseRunBody,
  PENDING_EE_TILES,
  stripMapToken,
  syncGeeRaster,
} from "@geolibre/plugins/earthengine";

const expr = {
  result: "0",
  values: {
    "0": {
      functionInvocationValue: {
        functionName: "Image.load",
        arguments: { id: { constantValue: "USGS/SRTMGL1_003" } },
      },
    },
  },
};

test("parseRunBody accepts Cloud API expression", () => {
  const body = parseRunBody(JSON.stringify({ expression: expr, op: "getMap", vis: { min: 0, max: 1 } }));
  assert.equal(body.op, "getMap");
  assert.equal(body.vis.min, 0);
  assert.ok(isCloudExpression(body.expression));
});

test("parseRunBody rejects JS text and unknown op", () => {
  assert.throws(() => parseRunBody("ee.Image('x').getMap()"), /invalid json/);
  assert.throws(() => parseRunBody(JSON.stringify({ expression: expr, op: "export" })), /invalid op/);
  assert.throws(() => parseRunBody(JSON.stringify({ expression: { foo: 1 }, op: "getInfo" })), /invalid expression/);
});

test("stripMapToken drops query token", () => {
  assert.equal(
    stripMapToken("https://earthengine.googleapis.com/map/abc/{z}/{x}/{y}?token=secret"),
    "https://earthengine.googleapis.com/map/abc/{z}/{x}/{y}",
  );
  assert.equal(stripMapToken("https://example/tiles/{z}/{x}/{y}?x=1&token=t"), "https://example/tiles/{z}/{x}/{y}?x=1");
});

test("eeRoute matches exact api path", () => {
  assert.equal(eeRoute("/project-demo/api/ee/run"), "run");
  assert.equal(eeRoute("/api/ee/ready"), "ready");
  assert.equal(eeRoute("/project-demo/api/ee/run/extra"), null);
  assert.equal(eeRoute("/project-demo/api/ee/map"), null);
  assert.equal(eeRoute("/other/api/ee/run"), null);
});

test("isGeeRaster accepts eeExpr", () => {
  assert.equal(isGeeRaster({ type: "xyz", metadata: { eeExpr: expr } }), true);
  assert.equal(isGeeRaster({ type: "xyz", metadata: { eeAsset: "USGS/SRTMGL1_003" } }), false);
  assert.equal(isGeeRaster({ type: "xyz", metadata: {} }), false);
});

test("syncGeeRaster deduplicates pending requests", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ urlFormat: "https://example/{z}/{x}/{y}" }));
  };
  try {
    const layer = {
      id: "pending-dedupe",
      type: "xyz",
      source: { type: "raster", tiles: [PENDING_EE_TILES] },
      metadata: { eeExpr: expr, eeVis: { min: 0, max: 1 } },
    };
    syncGeeRaster(layer);
    syncGeeRaster(layer);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
