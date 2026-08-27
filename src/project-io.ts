import { parseProject, serializeProject, type GeoLibreProject } from "@geolibre/core";
import type { FeatureCollection } from "geojson";
import { PENDING_EE_TILES } from "../plugins/earthengine/run";
import { getRasterAsset } from "./assets";
import {
  createProjectFileKey,
  PROJECT_SUFFIX,
  projectFileStem,
} from "./project-filename";

const PROJECT_API = `${import.meta.env?.BASE_URL ?? "/project-demo/"}api/projects`;
const ASSET_NAME = /^[\p{L}\p{N}._-]{1,160}$/u;

export interface RemoteProjectSummary {
  key: string;
  name: string;
  updatedAt: string;
}

async function request(path = "", init?: RequestInit): Promise<Response> {
  const response = await fetch(`${PROJECT_API}${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Project request failed (${response.status})`);
  }
  return response;
}

function layerTiles(layer: GeoLibreProject["layers"][number]): string[] | undefined {
  const source = layer.source as { tiles?: unknown } | undefined;
  return Array.isArray(source?.tiles) ? source.tiles.map(String) : undefined;
}

/** EE map URL 是临时资源：不持久化 eeVisFp / 已签发瓦片。 */
export function sanitizeGeeProject(project: GeoLibreProject): GeoLibreProject {
  return {
    ...project,
    layers: project.layers.map((layer) => {
      const tiles = layerTiles(layer);
      const stale = tiles?.some(
        (url) =>
          url.includes("earthengine.googleapis.com/") &&
          url !== PENDING_EE_TILES &&
          !url.includes("/map/pending/") &&
          (url.includes("/map/") || /\/v1\/.+\/maps\/.+\/tiles\//.test(url)),
      );
      const legacy = layer.metadata != null && ("eeVisFp" in layer.metadata || "eeKind" in layer.metadata);
      if (!stale && !legacy) return layer;
      const { eeVisFp: _fp, eeKind: _kind, ...metadata } = layer.metadata ?? {};
      return {
        ...layer,
        metadata,
        source: stale ? { type: "raster", tiles: [PENDING_EE_TILES], tileSize: 256 } : layer.source,
      };
    }),
  };
}

function validAssetName(value: unknown): value is string {
  return typeof value === "string" && value !== "." && value !== ".." && ASSET_NAME.test(value);
}

function assetName(
  layer: GeoLibreProject["layers"][number],
  extension: ".geojson" | ".tif" | ".tiff",
): string {
  return validAssetName(layer.metadata.projectAsset)
    ? layer.metadata.projectAsset
    : `${projectFileStem(layer.id)}${extension}`;
}

function assetUrl(key: string, file: string): string {
  return `${PROJECT_API}/${encodeURIComponent(key)}/data/${encodeURIComponent(file)}`;
}

async function uploadAsset(key: string, file: string, body: BodyInit, type: string): Promise<void> {
  await request(`/${encodeURIComponent(key)}/data/${encodeURIComponent(file)}`, {
    method: "PUT",
    headers: { "Content-Type": type },
    body,
  });
}

function sourceUrl(layer: GeoLibreProject["layers"][number]): string | null {
  return typeof layer.source.url === "string" && layer.source.url ? layer.source.url : null;
}

/** 将运行时数据写为独立文件；Project JSON 仅保留路径引用。 */
export async function prepareProjectForStorage(
  key: string | null,
  project: GeoLibreProject,
): Promise<GeoLibreProject> {
  const clean = sanitizeGeeProject(project);
  const layers: GeoLibreProject["layers"] = [];

  for (const layer of clean.layers) {
    if (layer.geojson) {
      const managed = validAssetName(layer.metadata.projectAsset);
      if (managed || !sourceUrl(layer)) {
        if (!key) throw new Error(`请先保存到 Remote：${layer.name} 尚无数据文件路径`);
        const file = assetName(layer, ".geojson");
        await uploadAsset(key, file, JSON.stringify(layer.geojson), "application/geo+json");
        layers.push({
          ...layer,
          source: { ...layer.source, type: "geojson", url: assetUrl(key, file) },
          geojson: undefined,
          metadata: { ...layer.metadata, projectAsset: file },
        });
        continue;
      }
      layers.push({ ...layer, geojson: undefined });
      continue;
    }

    const rasterId = typeof layer.source.assetId === "string" ? layer.source.assetId : null;
    if (rasterId) {
      if (!key) throw new Error(`请先保存到 Remote：${layer.name} 尚无数据文件路径`);
      const raster = await getRasterAsset(rasterId);
      if (!raster) throw new Error(`本地栅格资产不可用：${layer.name}`);
      const extension = /\.tiff$/i.test(raster.name) ? ".tiff" : ".tif";
      const file = assetName(layer, extension);
      await uploadAsset(key, file, raster, raster.type || "image/tiff");
      const { assetId: _assetId, ...source } = layer.source;
      layers.push({
        ...layer,
        source: { ...source, type: "raster", url: assetUrl(key, file) },
        metadata: { ...layer.metadata, projectAsset: file },
      });
      continue;
    }

    const managed = validAssetName(layer.metadata.projectAsset)
      ? layer.metadata.projectAsset
      : null;
    const remoteSource = sourceUrl(layer);
    if (key && managed && remoteSource) {
      const target = assetUrl(key, managed);
      if (remoteSource !== target) {
        const response = await fetch(remoteSource);
        if (!response.ok) throw new Error(`无法复制 ${layer.name}：${response.status}`);
        await uploadAsset(
          key,
          managed,
          await response.blob(),
          response.headers.get("Content-Type") || "application/octet-stream",
        );
      }
      layers.push({ ...layer, source: { ...layer.source, url: target } });
      continue;
    }

    layers.push(layer);
  }

  return { ...clean, layers };
}

function featureCollection(value: unknown, source: string): FeatureCollection {
  const data = value as FeatureCollection;
  if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    throw new Error(`${source} 不是 GeoJSON FeatureCollection`);
  }
  return data;
}

/** 运行时按 Project 中的路径加载矢量数据，不改变磁盘上的引用式 Project。 */
export async function hydrateProjectData(project: GeoLibreProject): Promise<GeoLibreProject> {
  return {
    ...project,
    layers: await Promise.all(
      project.layers.map(async (layer) => {
        if (layer.geojson || layer.type !== "geojson") return layer;
        const url = sourceUrl(layer);
        if (!url) return layer;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`无法加载 ${layer.name}：${response.status}`);
        return { ...layer, geojson: featureCollection(await response.json(), url) };
      }),
    ),
  };
}

export async function readProjectFile(file: File): Promise<GeoLibreProject> {
  return hydrateProjectData(parseProject(await file.text()));
}

export async function listRemoteProjects(): Promise<RemoteProjectSummary[]> {
  return (await request()).json();
}

export async function readRemoteProject(key: string): Promise<GeoLibreProject> {
  const project = parseProject(await (await request(`/${encodeURIComponent(key)}`)).text());
  return hydrateProjectData(project);
}

export async function saveRemoteProject(key: string, project: GeoLibreProject): Promise<void> {
  const stored = await prepareProjectForStorage(key, project);
  await request(`/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: serializeProject(stored),
  });
}

export async function deleteRemoteProject(key: string): Promise<void> {
  await request(`/${encodeURIComponent(key)}`, { method: "DELETE" });
}

export async function downloadProject(
  project: GeoLibreProject,
  remoteKey: string | null,
): Promise<void> {
  const fileKey = remoteKey ?? createProjectFileKey(project.name);
  const stored = await prepareProjectForStorage(remoteKey, project);
  const blob = new Blob([serializeProject(stored)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileKey}${PROJECT_SUFFIX}`;
  link.click();
  URL.revokeObjectURL(url);
}
