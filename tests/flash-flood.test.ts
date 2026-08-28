import assert from "node:assert/strict";
import test from "node:test";
import {
  createFlashFloodClient,
  eventRuleFields,
  FlashFloodApiError,
  groupGaugedSites,
  parseForcingCsv,
  sliceForcingByWindow,
} from "../plugins/flash-flood/client";
import { mergeForecastSeries, sampledIndices } from "../plugins/flash-flood/charts";
import { formatMetric } from "../plugins/flash-flood";

test("gauged sites split into national and medium-river groups", () => {
  assert.deepEqual(groupGaugedSites(["竹山", "孤山", "房县", "潘口"]), {
    national: ["房县", "孤山"],
    regional: ["潘口", "竹山"],
  });
});

test("event rules preserve HydroFloods day/hour semantics", () => {
  assert.deepEqual(eventRuleFields({
    qMin: 2,
    qPeak: 10,
    gapMaxHours: 48,
    minHours: 3,
    gapHours: 4,
    extendHours: 3,
  }), {
    threshold: 10,
    q_min: 2,
    q_peak: 10,
    gap_max_days: 2,
    min_hours: 3,
    gap_hours: 4,
    extend_hours: 3,
  });
});

test("forcing CSV accepts SpatialHydro column names", () => {
  assert.deepEqual(
    parseForcingCsv("time,P,PET_Romanenko,Q,R\n2024-01-01T00:00,2,0.3,4,1\n2024-01-01T01:00,5,0.2,8,2"),
    {
      time: ["2024-01-01T00:00", "2024-01-01T01:00"],
      P: [2, 5],
      PET: [0.3, 0.2],
      Q: [4, 8],
      R: [1, 2],
    },
  );
  assert.throws(() => parseForcingCsv("time,Q\na,2"), /缺少降雨列 P/);
  assert.throws(() => parseForcingCsv("P\nnot-a-number"), /不是有效数字/);
});

test("local forcing is split into forecast windows", () => {
  const forcing = parseForcingCsv(
    "time,P,Q\n2024-01-01T00:00,1,3\n2024-01-01T01:00,4,8\n2024-01-01T02:00,2,6",
  );
  assert.deepEqual(
    sliceForcingByWindow(forcing, "2024-01-01T01:00", "2024-01-01T02:00"),
    { time: ["2024-01-01T01:00", "2024-01-01T02:00"], P: [4, 2], Q: [8, 6] },
  );
  assert.throws(() => sliceForcingByWindow({ P: [1] }, "2024-01-01", "2024-01-02"), /time 列/);
});

test("FLASHCAST client uses project proxy and keeps regular simulation params server-side", async () => {
  const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
  const fetchFn: typeof fetch = async (input, init) => {
    requests.push({
      url: String(input),
      ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}),
    });
    if (String(input).endsWith("/model/sites")) return Response.json({ sites: ["孤山"] });
    return Response.json({ site: "孤山", series: { time: [], P: [], Q_obs: [], Q_sim: [] }, events: [] });
  };
  const client = createFlashFloodClient({ baseUrl: "/project-demo/api", fetch: fetchFn });
  assert.deepEqual(await client.sites(), ["孤山"]);
  await client.simulate({ site: "孤山", model_id: "XAJ" });
  assert.equal(requests[0]?.url, "/project-demo/api/model/sites");
  assert.equal(requests[1]?.url, "/project-demo/api/model/simulate");
  assert.equal(Object.hasOwn(requests[1]?.body ?? {}, "params"), false);
});

test("FLASHCAST client normalizes Julia lower/upper parameter bounds", async () => {
  const client = createFlashFloodClient({
    fetch: async () => Response.json({
      params: [{ name: "K", value: 1.1, lower: 0.2, upper: 1.5 }],
      source: "calibrated",
    }),
  });
  const result = await client.params("孤山", "XAJ");
  assert.deepEqual(result.params[0], {
    name: "K",
    value: 1.1,
    min: 0.2,
    max: 1.5,
    recommended: 1.1,
  });
});

test("FLASHCAST client reports backend detail", async () => {
  const client = createFlashFloodClient({
    fetch: async () => Response.json({ error: "Julia service unavailable" }, { status: 503 }),
  });
  await assert.rejects(
    () => client.health(),
    (error) => error instanceof FlashFloodApiError && error.status === 503 && /Julia/.test(error.message),
  );
});

test("hydrographs downsample and merge forecast at T0", () => {
  const indices = sampledIndices(1_000, 100);
  assert.equal(indices.length, 100);
  assert.equal(indices[0], 0);
  assert.equal(indices.at(-1), 999);
  const empty = { P: [1], Q_obs: [1], Q_sim: [2] };
  const merged = mergeForecastSeries(
    { time: ["h"], ...empty },
    { time: ["f"], ...empty },
  );
  assert.equal(merged.forecastStart, 1);
  assert.deepEqual(merged.series.time, ["h", "f"]);
  assert.equal(formatMetric(Number.NaN), "—");
  assert.equal(formatMetric(0.7654), "0.77");
});
