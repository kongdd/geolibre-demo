import { DEFAULT_LAYER_STYLE, type GeoLibreLayer } from "@geolibre/core";
import type { Feature, FeatureCollection, Position } from "geojson";

export const GEOMETRY_KIND = "gee-geometry";
export const DEFAULT_GEOMETRY_COLOR = "#c62828";
export const GEOMETRY_COLORS = ["#c62828", "#1565c0", "#2e7d32", "#ef6c00", "#6a1b9a"];

export function nextGeometryName(names: readonly string[]): string {
  const used = new Set(names);
  if (!used.has("geometry")) return "geometry";
  let index = 2;
  while (used.has(`geometry ${index}`)) index += 1;
  return `geometry ${index}`;
}

export function nextGeometryColor(used: readonly string[]): string {
  const taken = new Set(used.map((color) => color.toLowerCase()));
  return GEOMETRY_COLORS.find((color) => !taken.has(color)) ?? GEOMETRY_COLORS[used.length % GEOMETRY_COLORS.length];
}

export type GeometryMode = "pan" | "point" | "line" | "polygon" | "rectangle";

export function isGeometryLayer(layer: { metadata: { sourceKind?: unknown } }): boolean {
  return layer.metadata.sourceKind === GEOMETRY_KIND;
}

export function emptyCollection(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

export function vertexCount(collection: FeatureCollection | undefined): number {
  let count = 0;
  for (const feature of collection?.features ?? []) {
    count += countPositions(feature.geometry);
  }
  return count;
}

function countPositions(geometry: Feature["geometry"] | null): number {
  if (!geometry) return 0;
  if (geometry.type === "Point") return 1;
  if (geometry.type === "MultiPoint" || geometry.type === "LineString") return geometry.coordinates.length;
  if (geometry.type === "MultiLineString" || geometry.type === "Polygon") {
    return geometry.coordinates.reduce((sum, ring) => sum + openLength(ring), 0);
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.reduce(
      (sum, polygon) => sum + polygon.reduce((inner, ring) => inner + openLength(ring), 0),
      0,
    );
  }
  return 0;
}

function openLength(ring: Position[]): number {
  if (ring.length < 2) return ring.length;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring.length - 1 : ring.length;
}

export function rectangleRing(a: Position, b: Position): Position[] {
  const west = Math.min(a[0], b[0]);
  const east = Math.max(a[0], b[0]);
  const south = Math.min(a[1], b[1]);
  const north = Math.max(a[1], b[1]);
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

export function modeStatus(mode: GeometryMode): string {
  if (mode === "point") return "Point drawing.";
  if (mode === "line") return "Line drawing.";
  if (mode === "polygon") return "Polygon drawing.";
  if (mode === "rectangle") return "Rectangle drawing.";
  return "";
}

export function createGeometryLayer(name = "geometry", color = DEFAULT_GEOMETRY_COLOR): GeoLibreLayer {
  return {
    id: crypto.randomUUID(),
    name,
    type: "geojson",
    source: { type: "geojson" },
    geojson: emptyCollection(),
    visible: true,
    opacity: 1,
    style: {
      ...DEFAULT_LAYER_STYLE,
      fillColor: `${color}40`,
      strokeColor: color,
      strokeWidth: 2,
    },
    metadata: { sourceKind: GEOMETRY_KIND, color, locked: false },
  };
}

export function withColor(layer: GeoLibreLayer, color: string): Partial<GeoLibreLayer> {
  return {
    style: { ...layer.style, fillColor: `${color}40`, strokeColor: color },
    metadata: { ...layer.metadata, color },
  };
}

export function pointFeature(position: Position): Feature {
  return {
    type: "Feature",
    properties: { kind: "point" },
    geometry: { type: "Point", coordinates: position },
  };
}

export function lineFeature(positions: Position[]): Feature | null {
  if (positions.length < 2) return null;
  return {
    type: "Feature",
    properties: { kind: "line" },
    geometry: { type: "LineString", coordinates: positions },
  };
}

export function polygonFeature(positions: Position[]): Feature | null {
  if (positions.length < 3) return null;
  const ring = [...positions];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  return {
    type: "Feature",
    properties: { kind: "polygon" },
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}
