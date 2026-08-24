import { parseProject, serializeProject, type GeoLibreProject } from "@geolibre/core";

export async function readProjectFile(file: File): Promise<GeoLibreProject> {
  return parseProject(await file.text());
}

export function downloadProject(project: GeoLibreProject): void {
  const blob = new Blob([serializeProject(project)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${project.name.replace(/[^\p{L}\p{N}._-]+/gu, "_") || "project"}.geolibre.json`;
  link.click();
  URL.revokeObjectURL(url);
}
