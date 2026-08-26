import { parseProject, serializeProject, type GeoLibreProject } from "@geolibre/core";
import { PENDING_EE_TILES } from "../plugins/earthengine/run";

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

export async function readProjectFile(file: File): Promise<GeoLibreProject> {
  return parseProject(await file.text());
}

export function downloadProject(project: GeoLibreProject): void {
  const blob = new Blob([serializeProject(sanitizeGeeProject(project))], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${project.name.replace(/[^\p{L}\p{N}._-]+/gu, "_") || "project"}.geolibre.json`;
  link.click();
  URL.revokeObjectURL(url);
}
