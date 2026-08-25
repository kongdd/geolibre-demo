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

export type GeometryMode = "pan" | "point" | "line" | "polygon" | "rectangle" | "tilted" | "delete";

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

export function collectionKind(collection: FeatureCollection | undefined): "point" | "line" | "poly" {
  let point = false;
  let line = false;
  let poly = false;
  for (const feature of collection?.features ?? []) {
    const type = feature.geometry?.type ?? "";
    if (type.includes("Point")) point = true;
    else if (type.includes("Line")) line = true;
    else if (type.includes("Polygon")) poly = true;
  }
  if (poly) return "poly";
  if (line) return "line";
  return "point";
}

export function geometrySummary(collection: FeatureCollection | undefined): string {
  let points = 0;
  let lines = 0;
  let polys = 0;
  for (const feature of collection?.features ?? []) {
    const type = feature.geometry?.type ?? "";
    if (type.includes("Point")) points += 1;
    else if (type.includes("Line")) lines += 1;
    else if (type.includes("Polygon")) polys += 1;
  }
  const parts: string[] = [];
  if (points) parts.push(`${points} pt${points === 1 ? "" : "s"}`);
  if (lines) parts.push(`${lines} line${lines === 1 ? "" : "s"}`);
  if (polys) parts.push(`${polys} poly`);
  return parts.length ? `(${parts.join(", ")})` : "(empty)";
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

const RAD = Math.PI / 180;

function merc(p: Position): [number, number] {
  const lat = Math.max(-85, Math.min(85, p[1]));
  return [p[0] * RAD, Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2))];
}

function unmerc(p: [number, number]): Position {
  return [p[0] / RAD, (2 * Math.atan(Math.exp(p[1])) - Math.PI / 2) / RAD];
}

export function orientedRing(a: Position, b: Position, cursor: Position): Position[] | null {
  const A = merc(a);
  const B = merc(b);
  const P = merc(cursor);
  const dx = B[0] - A[0];
  const dy = B[1] - A[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-16) return null;
  const t = ((P[0] - B[0]) * -dy + (P[1] - B[1]) * dx) / len2;
  const ox = -dy * t;
  const oy = dx * t;
  if (ox * ox + oy * oy < 1e-16) return null;
  return [a, b, unmerc([B[0] + ox, B[1] + oy]), unmerc([A[0] + ox, A[1] + oy]), a];
}

export function modeStatus(mode: GeometryMode): string {
  if (mode === "point") return "Point drawing.";
  if (mode === "line") return "Line drawing.";
  if (mode === "polygon") return "Polygon drawing.";
  if (mode === "rectangle") return "Rectangle drawing.";
  if (mode === "tilted") return "Tilted rectangle.";
  return "";
}

export function dropFeature(collection: FeatureCollection, index: number): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: collection.features.filter((_, i) => i !== index),
  };
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
    metadata: { sourceKind: GEOMETRY_KIND, color },
  };
}

export function withColor(layer: GeoLibreLayer, color: string): Partial<GeoLibreLayer> {
  return {
    style: { ...layer.style, fillColor: `${color}40`, strokeColor: color },
    metadata: { ...layer.metadata, color },
  };
}

export function readLayerProps(metadata: { props?: unknown }): Record<string, string> {
  const value = metadata.props;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key) out[key] = item == null ? "" : String(item);
  }
  return out;
}

export function stampProps(feature: Feature, props: Record<string, string>): Feature {
  return { ...feature, properties: { ...feature.properties, ...props } };
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
