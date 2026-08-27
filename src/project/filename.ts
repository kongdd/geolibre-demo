export const PROJECT_SUFFIX = ".geolibre.json";

export function projectFileStem(name: string): string {
  const stem = name
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 80);
  return stem || "project";
}

export function createProjectFileKey(name: string): string {
  return projectFileStem(name);
}
