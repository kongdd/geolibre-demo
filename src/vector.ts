import { initialLayerStyle, type GeoLibreLayer } from "@geolibre/core";
import type { FeatureCollection } from "geojson";
import shp from "shpjs";

interface NamedFeatureCollection extends FeatureCollection {
  fileName?: string;
}

function isFeatureCollection(value: unknown): value is FeatureCollection {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "FeatureCollection" &&
    Array.isArray((value as { features?: unknown }).features)
  );
}

function baseName(name: string): string {
  return name.replace(/\.(geojson|json|zip)$/i, "");
}

export async function readVectorFile(file: File): Promise<NamedFeatureCollection[]> {
  if (/\.(geojson|json)$/i.test(file.name)) {
    const parsed: unknown = JSON.parse(await file.text());
    if (!isFeatureCollection(parsed)) throw new Error("文件不是 GeoJSON FeatureCollection");
    return [parsed];
  }
  if (!/\.zip$/i.test(file.name)) throw new Error("仅支持 GeoJSON 或 zipped Shapefile");
  const parsed = (await shp(await file.arrayBuffer())) as
    | NamedFeatureCollection
    | NamedFeatureCollection[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function createVectorLayer(
  name: string,
  geojson: FeatureCollection,
  existingLayers: GeoLibreLayer[],
): GeoLibreLayer {
  return {
    id: crypto.randomUUID(),
    name: baseName(name),
    type: "geojson",
    source: { type: "geojson" },
    geojson,
    visible: true,
    opacity: 1,
    style: initialLayerStyle({ geojson, layers: existingLayers }),
    metadata: {},
  };
}
