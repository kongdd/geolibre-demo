import {
  createEmptyProject,
  normalizeGroupContiguity,
  type GeoLibreLayer,
  type GeoLibreProject,
  type LayerGroup,
  type MapViewState,
} from "@geolibre/core";
import { createStore } from "zustand/vanilla";

function withId(project: GeoLibreProject): GeoLibreProject {
  return project.id ? project : { ...project, id: crypto.randomUUID() };
}

function createProject(name: string): GeoLibreProject {
  const base = import.meta.env?.BASE_URL ?? "/project-demo/";
  return withId(createEmptyProject(name, { basemapStyleUrl: `${base}style.json` }));
}

function sameView(a: MapViewState, b: MapViewState): boolean {
  return (
    a.center[0] === b.center[0] &&
    a.center[1] === b.center[1] &&
    a.zoom === b.zoom &&
    a.bearing === b.bearing &&
    a.pitch === b.pitch
  );
}

export interface ProjectState {
  project: GeoLibreProject;
  isDirty: boolean;
  selectedLayerId: string | null;
  newProject(name?: string): void;
  loadProject(project: GeoLibreProject): void;
  setProjectName(name: string): void;
  setMapView(view: MapViewState): void;
  setBasemapStyleUrl(url: string): void;
  addLayer(layer: GeoLibreLayer): void;
  addLayers(layers: GeoLibreLayer[]): void;
  updateLayer(id: string, patch: Partial<GeoLibreLayer>): void;
  removeLayer(id: string): void;
  moveLayer(id: string, targetIndex: number): void;
  selectLayer(id: string | null): void;
  addGroup(name: string): string;
  updateGroup(id: string, patch: Partial<LayerGroup>): void;
  removeGroup(id: string): void;
  moveLayerToGroup(layerId: string, groupId?: string): void;
  markSaved(): void;
}

export const projectStore = createStore<ProjectState>((set) => ({
  project: createProject("Map Project Demo"),
  isDirty: false,
  selectedLayerId: null,

  newProject: (name = "Untitled Project") =>
    set({ project: createProject(name), isDirty: false, selectedLayerId: null }),

  loadProject: (project) =>
    set({ project: withId(project), isDirty: false, selectedLayerId: null }),

  setProjectName: (name) =>
    set((state) => {
      if (!name.trim() || state.project.name === name.trim()) return state;
      return { project: { ...state.project, name: name.trim() }, isDirty: true };
    }),

  setMapView: (mapView) =>
    set((state) => {
      if (sameView(state.project.mapView, mapView)) return state;
      return { project: { ...state.project, mapView }, isDirty: true };
    }),

  setBasemapStyleUrl: (basemapStyleUrl) =>
    set((state) => {
      if (state.project.basemapStyleUrl === basemapStyleUrl) return state;
      return { project: { ...state.project, basemapStyleUrl }, isDirty: true };
    }),

  addLayer: (layer) =>
    set((state) => ({
      project: {
        ...state.project,
        layers: normalizeGroupContiguity([...state.project.layers, layer]),
      },
      selectedLayerId: layer.id,
      isDirty: true,
    })),

  addLayers: (layers) =>
    set((state) => {
      if (!layers.length) return state;
      return {
        project: {
          ...state.project,
          layers: normalizeGroupContiguity([...state.project.layers, ...layers]),
        },
        selectedLayerId: layers[layers.length - 1]?.id ?? state.selectedLayerId,
        isDirty: true,
      };
    }),

  updateLayer: (id, patch) =>
    set((state) => {
      let changed = false;
      const layers = state.project.layers.map((layer) => {
        if (layer.id !== id) return layer;
        changed = true;
        return { ...layer, ...patch };
      });
      if (!changed) return state;
      return {
        project: { ...state.project, layers: normalizeGroupContiguity(layers) },
        isDirty: true,
      };
    }),

  removeLayer: (id) =>
    set((state) => {
      const layers = state.project.layers.filter((layer) => layer.id !== id);
      if (layers.length === state.project.layers.length) return state;
      return {
        project: { ...state.project, layers },
        selectedLayerId: state.selectedLayerId === id ? null : state.selectedLayerId,
        isDirty: true,
      };
    }),

  moveLayer: (id, targetIndex) =>
    set((state) => {
      const layers = [...state.project.layers];
      const sourceIndex = layers.findIndex((layer) => layer.id === id);
      if (sourceIndex < 0) return state;
      const [layer] = layers.splice(sourceIndex, 1);
      layers.splice(Math.max(0, Math.min(targetIndex, layers.length)), 0, layer);
      return {
        project: { ...state.project, layers: normalizeGroupContiguity(layers) },
        isDirty: true,
      };
    }),

  selectLayer: (selectedLayerId) => set({ selectedLayerId }),

  addGroup: (name) => {
    const id = crypto.randomUUID();
    set((state) => ({
      project: {
        ...state.project,
        layerGroups: [
          ...(state.project.layerGroups ?? []),
          { id, name: name.trim() || "Group", collapsed: false, visible: true, opacity: 1 },
        ],
      },
      isDirty: true,
    }));
    return id;
  },

  updateGroup: (id, patch) =>
    set((state) => {
      let changed = false;
      const layerGroups = (state.project.layerGroups ?? []).map((group) => {
        if (group.id !== id) return group;
        changed = true;
        return {
          ...group,
          ...patch,
          opacity:
            patch.opacity === undefined ? group.opacity : Math.max(0, Math.min(1, patch.opacity)),
        };
      });
      return changed
        ? { project: { ...state.project, layerGroups }, isDirty: true }
        : state;
    }),

  removeGroup: (id) =>
    set((state) => ({
      project: {
        ...state.project,
        layerGroups: (state.project.layerGroups ?? [])
          .filter((group) => group.id !== id)
          .map((group) => (group.parentId === id ? { ...group, parentId: undefined } : group)),
        layers: state.project.layers.map((layer) =>
          layer.groupId === id ? { ...layer, groupId: undefined } : layer,
        ),
      },
      isDirty: true,
    })),

  moveLayerToGroup: (layerId, groupId) =>
    set((state) => {
      if (groupId && !(state.project.layerGroups ?? []).some((group) => group.id === groupId)) {
        return state;
      }
      return {
        project: {
          ...state.project,
          layers: normalizeGroupContiguity(
            state.project.layers.map((layer) =>
              layer.id === layerId ? { ...layer, groupId } : layer,
            ),
          ),
        },
        isDirty: true,
      };
    }),

  markSaved: () => set({ isDirty: false }),
}));
