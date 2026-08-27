import { buildLayerTree, type GeoLibreLayer, type LayerGroup } from "@geolibre/core";
import { collectionKind } from "@geolibre/plugins/geometry";
import { button } from "./dom";
import { dropInsertIndex } from "./layer-order";
import { projectStore } from "./project-store";
import { openLayerStyle, type LayerUiActions } from "./style-editor";

let host: HTMLDivElement;
let actions: LayerUiActions;

let contextMenu: HTMLDivElement | undefined;

function menu(): HTMLDivElement {
  if (contextMenu) return contextMenu;
  contextMenu = document.createElement("div");
  contextMenu.className = "context-menu";
  contextMenu.role = "menu";
  contextMenu.hidden = true;
  document.body.append(contextMenu);
  return contextMenu;
}

export function bindLayerTree(el: HTMLDivElement, next: LayerUiActions): void {
  host = el;
  actions = next;
}

export function closeContextMenu(): void {
  if (contextMenu) contextMenu.hidden = true;
}

export function isContextMenuOpen(): boolean {
  return Boolean(contextMenu && !contextMenu.hidden);
}

export function contextMenuButton(label: string, action: () => void, danger = false): HTMLButtonElement {
  const item = button(label, () => {
    closeContextMenu();
    action();
  });
  item.role = "menuitem";
  if (danger) item.className = "danger";
  return item;
}

export function showContextMenu(event: MouseEvent, items: HTMLButtonElement[]): void {
  event.preventDefault();
  placeContextMenu(items, event.clientX, event.clientY, true);
}

export function placeContextMenu(
  items: HTMLButtonElement[],
  left: number,
  top: number,
  clamp = false,
): void {
  const el = menu();
  el.replaceChildren(...items);
  el.hidden = false;
  el.style.left = clamp ? `${Math.min(left, innerWidth - el.offsetWidth - 8)}px` : `${left}px`;
  el.style.top = clamp ? `${Math.min(top, innerHeight - el.offsetHeight - 8)}px` : `${top}px`;
}

function openLayerContextMenu(layer: GeoLibreLayer, event: MouseEvent): void {
  const { project } = projectStore.getState();
  const index = project.layers.findIndex((candidate) => candidate.id === layer.id);
  projectStore.getState().selectLayer(layer.id);
  showContextMenu(event, [
    contextMenuButton("缩放到图层", () => actions.fitLayer(layer)),
    contextMenuButton("打开样式", () => openLayerStyle(layer.id)),
    contextMenuButton(layer.visible ? "隐藏图层" : "显示图层", () =>
      projectStore.getState().updateLayer(layer.id, { visible: !layer.visible }),
    ),
    contextMenuButton("上移", () => projectStore.getState().moveLayer(layer.id, index + 1)),
    contextMenuButton("下移", () => projectStore.getState().moveLayer(layer.id, index - 1)),
    contextMenuButton("移除图层", () => actions.removeLayer(layer), true),
  ]);
}

function openGroupContextMenu(group: LayerGroup, event: MouseEvent): void {
  showContextMenu(event, [
    contextMenuButton(group.collapsed ? "展开" : "折叠", () =>
      projectStore.getState().updateGroup(group.id, { collapsed: !group.collapsed }),
    ),
    contextMenuButton("移除组", () => projectStore.getState().removeGroup(group.id), true),
  ]);
}

if (typeof document !== "undefined") {
  document.addEventListener("click", closeContextMenu);
  window.addEventListener("blur", closeContextMenu);
}

function legendKind(layer: GeoLibreLayer): "point" | "line" | "poly" | "raster" {
  if (layer.type !== "geojson") return "raster";
  return collectionKind(layer.geojson);
}

function createLegend(layer: GeoLibreLayer): HTMLElement {
  const kind = legendKind(layer);
  if (kind === "raster") {
    const icon = document.createElement("img");
    icon.className = "legend-icon";
    icon.src = "icons/raster.svg";
    icon.alt = "";
    return icon;
  }
  const mark = document.createElement("span");
  mark.className = `legend-${kind}`;
  mark.style.setProperty("--fill", layer.style.fillColor);
  mark.style.setProperty("--stroke", layer.style.strokeColor);
  return mark;
}

function treeCheckbox(
  checked: boolean,
  onChange: (checked: boolean) => void,
): HTMLInputElement {
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.addEventListener("click", (event) => event.stopPropagation());
  box.addEventListener("change", () => onChange(box.checked));
  return box;
}

function dropLayerOn(sourceId: string, target: GeoLibreLayer, aboveInUi: boolean): void {
  const store = projectStore.getState();
  const source = store.project.layers.find((layer) => layer.id === sourceId);
  if (!source || source.id === target.id) return;
  if (source.groupId !== target.groupId) store.moveLayerToGroup(target.groupId, sourceId);
  const index = dropInsertIndex(
    projectStore.getState().project.layers.map((layer) => layer.id),
    sourceId,
    target.id,
    aboveInUi,
  );
  if (index !== null) projectStore.getState().moveLayer(sourceId, index);
}

function bindDropLine(row: HTMLElement, onDrop: (above: boolean, dt: DataTransfer | null) => void): void {
  row.addEventListener("dragover", (event) => {
    event.preventDefault();
    const above = event.offsetY < row.clientHeight / 2;
    row.classList.toggle("drop-above", above);
    row.classList.toggle("drop-below", !above);
  });
  row.addEventListener("dragleave", () => row.classList.remove("drop-above", "drop-below"));
  row.addEventListener("drop", (event) => {
    event.preventDefault();
    row.classList.remove("drop-above", "drop-below");
    onDrop(event.offsetY < row.clientHeight / 2, event.dataTransfer);
  });
}

function bindLayerDrag(row: HTMLElement, layer: GeoLibreLayer): void {
  const selected = projectStore.getState().selectedLayerId === layer.id;
  row.draggable = selected;
  row.addEventListener("dragstart", (event) => {
    if (projectStore.getState().selectedLayerId !== layer.id) {
      event.preventDefault();
      return;
    }
    event.dataTransfer?.setData("text/layer-id", layer.id);
    row.classList.add("dragging");
  });
  row.addEventListener("dragend", () => {
    row.classList.remove("dragging", "drop-above", "drop-below");
  });
  bindDropLine(row, (above, dt) => {
    const groupId = dt?.getData("text/group-id");
    if (groupId) {
      projectStore.getState().moveGroup(groupId, { type: "layer", id: layer.id }, above);
      return;
    }
    const sourceId = dt?.getData("text/layer-id");
    if (sourceId) dropLayerOn(sourceId, layer, above);
  });
}

function bindGroupDrag(row: HTMLElement, group: LayerGroup): void {
  row.draggable = true;
  row.addEventListener("dragstart", (event) => {
    if ((event.target as HTMLElement).closest("button, input")) {
      event.preventDefault();
      return;
    }
    event.dataTransfer?.setData("text/group-id", group.id);
    row.classList.add("dragging");
  });
  row.addEventListener("dragend", () => {
    row.classList.remove("dragging", "drop-above", "drop-below");
  });
  bindDropLine(row, (above, dt) => {
    const groupId = dt?.getData("text/group-id");
    if (groupId) {
      projectStore.getState().moveGroup(groupId, { type: "group", id: group.id }, above);
      return;
    }
    const sourceId = dt?.getData("text/layer-id");
    if (sourceId) projectStore.getState().moveLayerToGroup(group.id, sourceId);
  });
}

function treeGutter(child?: HTMLElement): HTMLSpanElement {
  const slot = document.createElement("span");
  slot.className = "tree-gutter";
  if (child) slot.append(child);
  return slot;
}

function createLayerRow(layer: GeoLibreLayer, depth = 0): HTMLDivElement {
  const { selectedLayerId } = projectStore.getState();
  const row = document.createElement("div");
  row.className = `tree-row${layer.id === selectedLayerId ? " selected" : ""}`;
  if (depth) row.style.paddingLeft = `${4 + depth * 14}px`;
  row.addEventListener("click", () => projectStore.getState().selectLayer(layer.id));
  row.addEventListener("dblclick", () => openLayerStyle(layer.id));
  row.addEventListener("contextmenu", (event) => openLayerContextMenu(layer, event));
  bindLayerDrag(row, layer);

  const name = document.createElement("span");
  name.className = "grow";
  name.textContent = layer.name;
  name.title = layer.name;
  row.append(
    treeGutter(),
    treeCheckbox(layer.visible, (checked) =>
      projectStore.getState().updateLayer(layer.id, { visible: checked }),
    ),
    createLegend(layer),
    name,
    rowDelete("删除", () => actions.removeLayer(layer)),
  );
  return row;
}

function createGroupRow(group: LayerGroup): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "tree-row group-row";
  row.addEventListener("contextmenu", (event) => openGroupContextMenu(group, event));
  bindGroupDrag(row, group);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "tree-toggle";
  toggle.textContent = group.collapsed ? "▸" : "▾";
  toggle.title = group.collapsed ? "展开" : "折叠";
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    projectStore.getState().updateGroup(group.id, { collapsed: !group.collapsed });
  });

  const folder = document.createElement("img");
  folder.className = "legend-icon";
  folder.src = "icons/folder.svg";
  folder.alt = "";

  const name = document.createElement("span");
  name.className = "grow";
  name.textContent = group.name;
  name.title = group.name;
  row.append(
    treeGutter(toggle),
    treeCheckbox(group.visible, (checked) =>
      projectStore.getState().updateGroup(group.id, { visible: checked }),
    ),
    folder,
    name,
    rowDelete("删除组", () => projectStore.getState().removeGroup(group.id)),
  );
  return row;
}

function rowDelete(title: string, action: () => void): HTMLButtonElement {
  const del = button("×", action, title);
  del.className = "row-del";
  return del;
}

export function renderLayers(): void {
  const { project } = projectStore.getState();
  host.replaceChildren();
  for (const item of buildLayerTree(project.layers, project.layerGroups ?? [])) {
    if (item.kind === "group") {
      host.append(createGroupRow(item.group));
      if (!item.group.collapsed) {
        for (const layer of item.children) host.append(createLayerRow(layer, 1));
      }
    } else {
      host.append(createLayerRow(item.layer));
    }
  }
}
