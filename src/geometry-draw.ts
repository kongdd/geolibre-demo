import type { Feature, Position } from "geojson";
import {
  lineFeature,
  orientedRing,
  pointFeature,
  polygonFeature,
  rectangleRing,
  type GeometryMode,
} from "./geometry";

export type DrawState = {
  mode: GeometryMode;
  draft: Position[];
  rectStart: Position | null;
};

export type DrawStep = {
  state: DrawState;
  commit: Feature | null;
};

export function emptyDraw(mode: GeometryMode = "pan"): DrawState {
  return { mode, draft: [], rectStart: null };
}

export function setDrawMode(mode: GeometryMode): DrawState {
  return emptyDraw(mode);
}

export function acceptCommit(mode: GeometryMode, feature: Feature | null): Feature | null {
  if (!feature) return null;
  if (mode === "point") return feature.geometry.type === "Point" ? feature : null;
  return feature.geometry.type === "Point" ? null : feature;
}

export function clickDraw(state: DrawState, point: Position): DrawStep {
  if (state.mode === "point") {
    return { state, commit: acceptCommit(state.mode, pointFeature(point)) };
  }
  if (state.mode === "line" || state.mode === "polygon") {
    return { state: { ...state, draft: [...state.draft, point] }, commit: null };
  }
  if (state.mode === "rectangle") {
    if (!state.rectStart) return { state: { ...state, rectStart: point }, commit: null };
    return {
      state: { ...state, rectStart: null },
      commit: acceptCommit(state.mode, rectFeature(state.rectStart, point)),
    };
  }
  if (state.mode === "tilted") {
    if (state.draft.length < 2) {
      return { state: { ...state, draft: [...state.draft, point] }, commit: null };
    }
    const feature = tiltedFeature(state.draft[0], state.draft[1], point);
    if (!feature) return { state, commit: null };
    return { state: { ...state, draft: [] }, commit: acceptCommit(state.mode, feature) };
  }
  return { state, commit: null };
}

export function finishDraw(state: DrawState): DrawStep {
  const commit =
    state.mode === "line"
      ? lineFeature(state.draft)
      : state.mode === "polygon"
        ? polygonFeature(state.draft)
        : null;
  return { state: { ...state, draft: [] }, commit: acceptCommit(state.mode, commit) };
}

export function finishRect(state: DrawState, end: Position): DrawStep {
  if (state.mode !== "rectangle" || !state.rectStart) return { state, commit: null };
  const feature = rectFeature(state.rectStart, end);
  if (!feature) return { state, commit: null };
  return { state: { ...state, rectStart: null }, commit: acceptCommit(state.mode, feature) };
}

export function previewDraw(state: DrawState, cursor: Position): Feature | null {
  if (state.mode === "rectangle" && state.rectStart) {
    return rectFeature(state.rectStart, cursor);
  }
  if (state.mode === "tilted") {
    if (state.draft.length >= 2) return tiltedFeature(state.draft[0], state.draft[1], cursor);
    if (state.draft.length === 1) return lineFeature([state.draft[0], cursor]);
    return null;
  }
  if (state.mode === "line") return lineFeature([...state.draft, cursor]);
  if (state.mode === "polygon") return polygonFeature([...state.draft, cursor]);
  return null;
}

function tiltedFeature(a: Position, b: Position, cursor: Position): Feature | null {
  const ring = orientedRing(a, b, cursor);
  return ring ? polygonFeature(ring.slice(0, 4)) : null;
}

function rectFeature(start: Position, end: Position): Feature | null {
  const ring = rectangleRing(start, end);
  if (Math.abs(ring[0][0] - ring[1][0]) <= 1e-6 && Math.abs(ring[0][1] - ring[2][1]) <= 1e-6) {
    return null;
  }
  return polygonFeature(ring.slice(0, 4));
}
