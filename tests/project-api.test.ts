import { createEmptyProject, DEFAULT_LAYER_STYLE, serializeProject } from "@geolibre/core";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  deleteStoredProject,
  listStoredProjects,
  projectRoute,
  readStoredAsset,
  readStoredProject,
  writeStoredAsset,
  writeStoredProject,
} from "../plugins/projects/plugin";

test("remote project storage keeps project and data in separate files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "geolibre-projects-"));
  const key = "丹江口-1234";
  const content = serializeProject(createEmptyProject("丹江口"));
  const asset = Buffer.from('{"type":"FeatureCollection","features":[]}');
  try {
    await writeStoredAsset(key, "basin.geojson", asset, directory);
    await writeStoredProject(key, content, directory);
    assert.deepEqual((await listStoredProjects(directory))[0], {
      key,
      name: "丹江口",
      updatedAt: (await listStoredProjects(directory))[0]!.updatedAt,
    });
    assert.equal(await readStoredProject(key, directory), content);
    assert.deepEqual(await readStoredAsset(key, "basin.geojson", directory), asset);
    await deleteStoredProject(key, directory);
    assert.deepEqual(await listStoredProjects(directory), []);
    await assert.rejects(() => readStoredAsset(key, "basin.geojson", directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("project storage rejects embedded layer data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "geolibre-projects-"));
  const project = createEmptyProject("Bad");
  project.layers.push({
    id: "embedded",
    name: "Embedded",
    type: "geojson",
    source: { type: "geojson" },
    geojson: { type: "FeatureCollection", features: [] },
    visible: true,
    opacity: 1,
    style: { ...DEFAULT_LAYER_STYLE },
    metadata: {},
  });
  try {
    await assert.rejects(
      () => writeStoredProject("bad", serializeProject(project), directory),
      /file references/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("project API route accepts data files and rejects path traversal", () => {
  assert.deepEqual(projectRoute("/project-demo/api/projects/%E4%B8%B9%E6%B1%9F/data/a.geojson"), {
    key: "丹江",
    asset: "a.geojson",
  });
  assert.equal(projectRoute("/project-demo/api/projects/..%2Fsecret"), null);
  assert.equal(projectRoute("/project-demo/api/projects/demo/data/..%2Fsecret"), null);
});
