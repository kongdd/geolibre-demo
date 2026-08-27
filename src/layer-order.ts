import {
  buildLayerPanelUnits,
  reorderLayerGroupInPanel,
  type GeoLibreLayer,
  type LayerGroup,
} from "@geolibre/core";

const BASEMAP_KIND = "maplibre-basemap-control";

export function isBasemapLayer(layer: { metadata: { sourceKind?: unknown } }): boolean {
  return layer.metadata.sourceKind === BASEMAP_KIND;
}

/** Store index for a new basemap: front of existing basemaps, under data layers. */
export function basemapInsertIndex(
  layers: { id: string; metadata: { sourceKind?: unknown } }[],
  newId: string,
): number {
  const rest = layers.filter((layer) => layer.id !== newId);
  const index = rest.findIndex((layer) => !isBasemapLayer(layer));
  return index < 0 ? rest.length : index;
}

type OcclusionLayer = {
  id: string;
  visible: boolean;
  opacity: number;
  metadata: { sourceKind?: unknown };
};

/** Visible opaque basemap on top covers every basemap below it. */
export function occludedBasemapIds(layers: readonly OcclusionLayer[]): Set<string> {
  const hidden = new Set<string>();
  let covered = false;
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index];
    if (!isBasemapLayer(layer)) continue;
    if (covered) hidden.add(layer.id);
    else if (layer.visible && layer.opacity >= 1) covered = true;
  }
  return hidden;
}

export function applyBasemapOcclusion<T extends OcclusionLayer>(layers: T[]): T[] {
  const hidden = occludedBasemapIds(layers);
  if (hidden.size === 0) return layers;
  return layers.map((layer) => (hidden.has(layer.id) ? { ...layer, visible: false } : layer));
}

export function basemapNativeIds(layer: {
  metadata: { nativeLayerIds?: unknown; basemapId?: unknown };
}): string[] {
  const ids: string[] = [];
  const raw = layer.metadata.nativeLayerIds;
  if (Array.isArray(raw)) {
    for (const id of raw) if (typeof id === "string" && id) ids.push(id);
  }
  if (typeof layer.metadata.basemapId === "string" && layer.metadata.basemapId) {
    ids.push(layer.metadata.basemapId);
  }
  return [...new Set(ids)];
}

/** moveLayer insert index after dropping `sourceId` on `targetId`. UI is store-reversed. */
export function dropInsertIndex(
  ids: string[],
  sourceId: string,
  targetId: string,
  aboveInUi: boolean,
): number | null {
  if (sourceId === targetId) return null;
  const next = ids.filter((id) => id !== sourceId);
  const target = next.indexOf(targetId);
  if (target < 0) return null;
  return aboveInUi ? target + 1 : target;
}

export type DropTarget = { type: "group" | "layer"; id: string };

/** Walk `reorderLayerGroupInPanel` until `sourceId` sits above/below `target`. */
export function dropGroupOn(
  layers: GeoLibreLayer[],
  groups: LayerGroup[],
  sourceId: string,
  target: DropTarget,
  aboveInUi: boolean,
): { layers: GeoLibreLayer[]; groups: LayerGroup[] } | null {
  if (target.type === "group" && target.id === sourceId) return null;
  let current = { layers, groups };
  for (let i = 0; i < layers.length + groups.length + 1; i++) {
    const units = buildLayerPanelUnits(current.layers, current.groups);
    const srcIdx = units.findIndex((unit) => unit.groupId === sourceId);
    const tgtIdx =
      target.type === "group"
        ? units.findIndex((unit) => unit.groupId === target.id)
        : units.findIndex((unit) => unit.layers.some((layer) => layer.id === target.id));
    if (srcIdx < 0 || tgtIdx < 0 || srcIdx === tgtIdx) return i === 0 ? null : current;
    if (aboveInUi ? srcIdx === tgtIdx - 1 : srcIdx === tgtIdx + 1) {
      return i === 0 ? null : current;
    }
    const next = reorderLayerGroupInPanel(
      current.layers,
      current.groups,
      sourceId,
      srcIdx < tgtIdx ? "down" : "up",
    );
    if (!next) return i === 0 ? null : current;
    current = next;
  }
  return current;
}
