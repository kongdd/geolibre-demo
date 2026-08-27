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

export function hasLegacyUuid(key: string): boolean {
  return /(?:^|-)[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key);
}
