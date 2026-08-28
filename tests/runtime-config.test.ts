import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const start = await readFile(new URL("../start.sh", import.meta.url), "utf8");

test("production starts full SpatialHydro and Julia services", () => {
  assert.match(start, /spatialhydro-backend/);
  assert.match(start, /julia_service\/bin\/server\.jl/);
  assert.match(start, /JULIA_MODEL_URL=http:\/\/127\.0\.0\.1:\$julia_port/);
  assert.match(start, /api\/model\/sites/);
});

test("legacy watershed-only service is disabled before SpatialHydro binds 8765", () => {
  assert.match(start, /disable --now "\$legacy_unit"/);
  assert.match(start, /SPATIALHYDRO_PORT:-8765/);
});
