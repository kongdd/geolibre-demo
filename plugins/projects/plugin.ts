import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseProject } from "@geolibre/core";
import type { Plugin } from "vite";
import { PROJECT_SUFFIX } from "../../src/project-filename.ts";

const PROJECT_DIR = fileURLToPath(new URL("../../public/projects/", import.meta.url));
const PROJECT_BODY_LIMIT = 10 * 1024 * 1024;
const ASSET_BODY_LIMIT = 4 * 1024 * 1024 * 1024;
const PROJECT_KEY = /^[\p{L}\p{N}._-]{1,128}$/u;
const ASSET_NAME = /^[\p{L}\p{N}._-]{1,160}$/u;

export interface RemoteProjectSummary {
  key: string;
  name: string;
  updatedAt: string;
}

export interface ProjectRoute {
  key?: string;
  asset?: string;
}

function valid(value: string, pattern: RegExp): boolean {
  return value !== "." && value !== ".." && pattern.test(value);
}

export function projectRoute(pathname: string): ProjectRoute | null {
  const match = pathname
    .replace(/\/+$/, "")
    .match(/^(?:\/project-demo)?\/api\/projects(?:\/([^/]+)(?:\/data\/([^/]+))?)?$/);
  if (!match) return null;
  try {
    const key = match[1] ? decodeURIComponent(match[1]) : undefined;
    const asset = match[2] ? decodeURIComponent(match[2]) : undefined;
    if ((key && !valid(key, PROJECT_KEY)) || (asset && !valid(asset, ASSET_NAME))) return null;
    return { key, asset };
  } catch {
    return null;
  }
}

function projectPath(directory: string, key: string): string {
  if (!valid(key, PROJECT_KEY)) {
    throw Object.assign(new Error("invalid project key"), { status: 400 });
  }
  return join(directory, `${key}${PROJECT_SUFFIX}`);
}

function projectDataPath(directory: string, key: string): string {
  projectPath(directory, key);
  return join(directory, key, "data");
}

function assetPath(directory: string, key: string, asset: string): string {
  if (!valid(asset, ASSET_NAME)) {
    throw Object.assign(new Error("invalid asset name"), { status: 400 });
  }
  return join(projectDataPath(directory, key), asset);
}

export async function listStoredProjects(directory = PROJECT_DIR): Promise<RemoteProjectSummary[]> {
  await mkdir(directory, { recursive: true });
  const files = (await readdir(directory)).filter((file) => file.endsWith(PROJECT_SUFFIX));
  const projects = await Promise.all(
    files.map(async (file) => {
      try {
        const path = join(directory, file);
        const [project, info] = await Promise.all([
          readFile(path, "utf8").then(parseProject),
          stat(path),
        ]);
        return {
          key: file.slice(0, -PROJECT_SUFFIX.length),
          name: project.name,
          updatedAt: info.mtime.toISOString(),
        };
      } catch {
        return null;
      }
    }),
  );
  return projects
    .filter((project): project is RemoteProjectSummary => project !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readStoredProject(key: string, directory = PROJECT_DIR): Promise<string> {
  return readFile(projectPath(directory, key), "utf8");
}

export async function writeStoredProject(
  key: string,
  content: string,
  directory = PROJECT_DIR,
): Promise<void> {
  let project;
  try {
    project = parseProject(content);
  } catch {
    throw Object.assign(new Error("invalid project"), { status: 400 });
  }
  if (project.layers.some((layer) => layer.geojson || typeof layer.source.assetId === "string")) {
    throw Object.assign(new Error("project data must be stored as file references"), { status: 400 });
  }
  await mkdir(directory, { recursive: true });
  const path = projectPath(directory, key);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
  try {
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function writeStoredAsset(
  key: string,
  asset: string,
  source: AsyncIterable<Uint8Array | string> | Uint8Array,
  directory = PROJECT_DIR,
): Promise<void> {
  const path = assetPath(directory, key, asset);
  await mkdir(projectDataPath(directory, key), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx");
  let size = 0;
  try {
    const chunks = source instanceof Uint8Array ? [source] : source;
    for await (const chunk of chunks) {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      size += buffer.byteLength;
      if (size > ASSET_BODY_LIMIT) {
        throw Object.assign(new Error("asset too large"), { status: 413 });
      }
      await file.write(buffer);
    }
    await file.close();
    await rename(temporary, path);
  } catch (error) {
    await file.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function readStoredAsset(
  key: string,
  asset: string,
  directory = PROJECT_DIR,
): Promise<Buffer> {
  return readFile(assetPath(directory, key, asset));
}

export async function deleteStoredProject(key: string, directory = PROJECT_DIR): Promise<void> {
  await unlink(projectPath(directory, key));
  await rm(join(directory, key), { recursive: true, force: true });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  const forwarded = req.headers["x-forwarded-host"];
  const host = String(Array.isArray(forwarded) ? forwarded[0] : forwarded ?? req.headers.host ?? "")
    .split(",")[0]!
    .trim();
  try {
    return typeof origin === "string" && new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > PROJECT_BODY_LIMIT) {
      throw Object.assign(new Error("project too large"), { status: 413 });
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function assetType(name: string): string {
  if (/\.geojson$|\.json$/i.test(name)) return "application/geo+json";
  if (/\.tiff?$/i.test(name)) return "image/tiff";
  return "application/octet-stream";
}

function rangeOf(header: string | undefined, size: number): [number, number] | null {
  if (!header) return null;
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) throw Object.assign(new Error("invalid range"), { status: 416 });
  const suffix = match[1] === "";
  const start = suffix ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  const end = suffix || match[2] === "" ? size - 1 : Math.min(size - 1, Number(match[2]));
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= size) {
    throw Object.assign(new Error("invalid range"), { status: 416 });
  }
  return [start, end];
}

async function serveAsset(
  req: IncomingMessage,
  res: ServerResponse,
  key: string,
  asset: string,
): Promise<void> {
  const path = assetPath(PROJECT_DIR, key, asset);
  const { size } = await stat(path);
  const range = rangeOf(typeof req.headers.range === "string" ? req.headers.range : undefined, size);
  const [start, end] = range ?? [0, size - 1];
  res.statusCode = range ? 206 : 200;
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", assetType(asset));
  res.setHeader("Content-Length", end - start + 1);
  if (range) res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  if (req.method === "HEAD") return void res.end();
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path, { start, end });
    stream.on("error", reject);
    res.on("finish", resolve);
    stream.pipe(res);
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
  const route = projectRoute(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
  if (!route) return next();
  try {
    if (route.key && route.asset) {
      if (req.method === "GET" || req.method === "HEAD") {
        return await serveAsset(req, res, route.key, route.asset);
      }
      if (req.method !== "PUT") return json(res, 405, { error: "method" });
      if (!sameOrigin(req)) return json(res, 403, { error: "origin" });
      await writeStoredAsset(route.key, route.asset, req);
      return json(res, 200, { ok: true });
    }
    if (req.method === "GET" && !route.key) return json(res, 200, await listStoredProjects());
    if (req.method === "GET" && route.key) {
      res.setHeader("Content-Type", "application/json");
      res.end(await readStoredProject(route.key));
      return;
    }
    if (!route.key) return json(res, 405, { error: "method" });
    if (!sameOrigin(req)) return json(res, 403, { error: "origin" });
    if (req.method === "PUT") {
      await writeStoredProject(route.key, await readBody(req));
      return json(res, 200, { ok: true });
    }
    if (req.method === "DELETE") {
      await deleteStoredProject(route.key);
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: "method" });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const status = code === "ENOENT" ? 404 : Number((error as { status?: unknown }).status) || 500;
    console.error("[projects]", error);
    json(res, status, { error: status === 500 ? "project request failed" : (error as Error).message });
  }
}

/** public/projects：Project 文件及其独立数据目录。 */
export function projectApiPlugin(): Plugin {
  const attach = (server: { middlewares: { use: (fn: typeof handle) => void } }) => {
    server.middlewares.use(handle);
  };
  return {
    name: "project-api",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
