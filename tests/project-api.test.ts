import { createEmptyProject, DEFAULT_LAYER_STYLE, serializeProject } from "@geolibre/core";
import assert from "node:assert/strict";
import { mkdtemp, rm, symlink } from "node:fs/promises";
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
import { PROJECT_SUFFIX } from "../src/project/filename";

test("remote project storage keeps project and data in separate files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "geolibre-projects-"));
  const key = "丹江口-1234";
  const project = createEmptyProject("丹江口");
  project.layers.push({
    id: "basin",
    name: "流域",
    type: "geojson",
    source: { type: "geojson", url: `/api/projects/${key}/data/basin.geojson` },
    visible: true,
    opacity: 1,
    style: { ...DEFAULT_LAYER_STYLE },
    metadata: { projectAsset: "basin.geojson" },
  });
  project.layers.push({
    id: "pour",
    name: "Pour_出水口",
    type: "geojson",
    source: { type: "geojson", url: `/api/projects/${key}/data/Basins/pour.geojson` },
    visible: true,
    opacity: 1,
    style: { ...DEFAULT_LAYER_STYLE },
    metadata: { projectAsset: "Basins/pour.geojson" },
  });
  const content = serializeProject(project);
  const asset = Buffer.from('{"type":"FeatureCollection","features":[]}');
  try {
    await writeStoredAsset(key, "basin.geojson", asset, directory);
    await writeStoredAsset(key, "Basins/pour.geojson", asset, directory);
    await writeStoredAsset(key, "Basins/stale.geojson", asset, directory);
    await writeStoredAsset(key, "stale.geojson", asset, directory);
    await writeStoredProject(key, content, directory);
    await symlink(
      `${key}${PROJECT_SUFFIX}`,
      join(directory, `864c6b4d-5550-4341-9d93-8137b6678bc0${PROJECT_SUFFIX}`),
    );
    assert.deepEqual((await listStoredProjects(directory))[0], {
      key,
      name: "丹江口",
      updatedAt: (await listStoredProjects(directory))[0]!.updatedAt,
      aliases: ["864c6b4d-5550-4341-9d93-8137b6678bc0"],
    });
    assert.equal(await readStoredProject(key, directory), content);
    assert.deepEqual(await readStoredAsset(key, "basin.geojson", directory), asset);
    assert.deepEqual(await readStoredAsset(key, "Basins/pour.geojson", directory), asset);
    await assert.rejects(() => readStoredAsset(key, "stale.geojson", directory));
    await assert.rejects(() => readStoredAsset(key, "Basins/stale.geojson", directory));
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
  assert.deepEqual(projectRoute("/project-demo/api/projects/demo/data/Basins/a.geojson"), {
    key: "demo",
    asset: "Basins/a.geojson",
  });
  assert.equal(projectRoute("/project-demo/api/projects/..%2Fsecret"), null);
  assert.equal(projectRoute("/project-demo/api/projects/demo/data/..%2Fsecret"), null);
  assert.equal(projectRoute("/project-demo/api/projects/demo/data/Basins/..%2Fsecret"), null);
});
