import { timingSafeEqual, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdir, unlink } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { Plugin, ViteDevServer, PreviewServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SESSION_DIR = resolve(process.env.PI_CHAT_SESSION_DIR ?? join(homedir(), ".pi/agent/project-demo-chat"));
const SESSION_KEY = /^[\w.:-]{1,180}\.jsonl$/;
const BODY_LIMIT = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_PROCESSES = 8;
const IDLE_MS = 30 * 60_000;
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const PI_BIN = process.env.PI_CHAT_BIN
  ?? [join(homedir(), ".bun/bin/pi"), join(homedir(), ".local/bin/pi")].find(existsSync)
  ?? "pi";

type Json = Record<string, unknown>;
type Listener = (event: Json) => void;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  timestamp?: number;
}

export interface PromptImage {
  type: "image";
  data: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
}

export function normalizePromptImages(value: unknown): PromptImage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 1) {
    throw Object.assign(new Error("每次最多共享一张界面截图"), { status: 400 });
  }
  return value.map((item) => {
    if (!item || typeof item !== "object") throw Object.assign(new Error("无效截图"), { status: 400 });
    const image = item as Json;
    const mimeType = image.mimeType;
    const data = image.data;
    if (image.type !== "image" || !["image/jpeg", "image/png", "image/webp"].includes(String(mimeType))) {
      throw Object.assign(new Error("不支持的截图格式"), { status: 400 });
    }
    if (typeof data !== "string" || data.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
      throw Object.assign(new Error("截图无效或过大"), { status: 413 });
    }
    return { type: "image", data, mimeType } as PromptImage;
  });
}

function contentText(content: unknown, type: "text" | "thinking" = "text"): string {
  if (typeof content === "string") return type === "text" ? content : "";
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is Json => Boolean(part) && typeof part === "object")
    .filter((part) => part.type === type && typeof part[type] === "string")
    .map((part) => String(part[type]))
    .join("");
}

export function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const message = item as Json;
    if (message.role !== "user" && message.role !== "assistant") return [];
    const content = contentText(message.content);
    if (!content) return [];
    const result: ChatMessage = { role: message.role, content };
    const thinking = contentText(message.content, "thinking");
    if (thinking) result.thinking = thinking;
    if (typeof message.timestamp === "number") result.timestamp = message.timestamp;
    return [result];
  });
}

function modelSummary(value: unknown): Json | null {
  if (!value || typeof value !== "object") return null;
  const model = value as Json;
  if (typeof model.provider !== "string" || typeof model.id !== "string") return null;
  return {
    provider: model.provider,
    id: model.id,
    name: typeof model.name === "string" ? model.name : model.id,
    reasoning: model.reasoning === true,
    thinkingLevelMap: model.thinkingLevelMap && typeof model.thinkingLevelMap === "object"
      ? model.thinkingLevelMap
      : undefined,
  };
}

class PiProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly listeners = new Set<Listener>();
  key?: string;
  busy = false;
  lastUsed = Date.now();
  private stderr = "";

  constructor(sessionPath?: string) {
    const args = ["--mode", "rpc", "--session-dir", SESSION_DIR];
    if (sessionPath) args.push("--session", sessionPath);
    this.child = spawn(PI_BIN, args, { cwd: ROOT, stdio: "pipe" });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      try {
        this.emit(JSON.parse(line) as Json);
      } catch {
        this.emit({ type: "rpc_error", error: "Pi 返回了无效数据" });
      }
    });
    this.child.stderr.on("data", (chunk) => {
      this.stderr = (this.stderr + String(chunk)).slice(-2000);
    });
    this.child.once("error", (error) => this.emit({ type: "rpc_error", error: error.message }));
    this.child.once("exit", (code) => {
      this.emit({ type: "rpc_error", error: this.stderr.trim() || `Pi 已退出（${code ?? "signal"}）` });
      processes.delete(this);
      if (this.key && sessions.get(this.key) === this) sessions.delete(this.key);
    });
  }

  private emit(event: Json): void {
    for (const listener of this.listeners) listener(event);
  }

  async request(command: Json, timeout = 20_000): Promise<Json> {
    this.lastUsed = Date.now();
    const id = randomUUID();
    return new Promise((resolveRequest, reject) => {
      const finish = (error?: Error, event?: Json) => {
        clearTimeout(timer);
        this.listeners.delete(listener);
        error ? reject(error) : resolveRequest(event!);
      };
      const listener: Listener = (event) => {
        if (event.type === "rpc_error") finish(new Error(String(event.error)));
        else if (event.type === "response" && event.id === id) {
          if (event.success === false) finish(new Error(String(event.error ?? "Pi 请求失败")));
          else finish(undefined, event);
        }
      };
      const timer = setTimeout(() => finish(new Error("Pi 响应超时")), timeout);
      this.listeners.add(listener);
      this.child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
    });
  }

  async state(): Promise<Json> {
    const response = await this.request({ type: "get_state" });
    const state = response.data as Json;
    const sessionFile = String(state.sessionFile ?? "");
    const key = basename(sessionFile);
    if (!SESSION_KEY.test(key) || resolve(dirname(sessionFile)) !== SESSION_DIR) throw new Error("无效的 Pi 会话路径");
    this.key = key;
    sessions.set(key, this);
    return state;
  }

  dispose(): void {
    this.listeners.clear();
    this.child.kill();
  }
}

const sessions = new Map<string, PiProcess>();
const processes = new Set<PiProcess>();
const requests = new Map<string, { minute: number; count: number }>();

function sessionPath(key: string): string {
  if (!SESSION_KEY.test(key)) throw Object.assign(new Error("无效会话"), { status: 400 });
  return join(SESSION_DIR, key);
}

async function getSession(key?: unknown): Promise<PiProcess> {
  if (typeof key === "string") {
    const active = sessions.get(key);
    if (active) return active;
    const path = sessionPath(key);
    try {
      await access(path);
    } catch {
      throw Object.assign(new Error("会话不存在"), { status: 404 });
    }
    const session = createProcess(path);
    session.key = key;
    sessions.set(key, session);
    return session;
  }
  return createProcess();
}

function createProcess(path?: string): PiProcess {
  if (processes.size >= MAX_PROCESSES) throw Object.assign(new Error("Pi 会话过多，请稍后重试"), { status: 503 });
  const session = new PiProcess(path);
  processes.add(session);
  return session;
}

function disposeIdle(): void {
  const cutoff = Date.now() - IDLE_MS;
  for (const session of processes) {
    if (!session.busy && session.lastUsed < cutoff) session.dispose();
  }
}
const idleTimer = setInterval(disposeIdle, 5 * 60_000);
idleTimer.unref();

export function piAgentRoute(pathname: string): boolean {
  return /^(?:\/project-demo)?\/api\/pi-agent\/?$/.test(pathname);
}

function allowRequest(req: IncomingMessage): boolean {
  const forwarded = req.headers["x-forwarded-for"];
  const address = String(Array.isArray(forwarded) ? forwarded[0] : forwarded ?? req.socket.remoteAddress ?? "unknown")
    .split(",")[0]!.trim();
  const minute = Math.floor(Date.now() / 60_000);
  const hit = requests.get(address);
  if (!hit || hit.minute !== minute) {
    if (requests.size > 10_000) requests.clear();
    requests.set(address, { minute, count: 1 });
    return true;
  }
  return ++hit.count <= 60;
}

function authorized(req: IncomingMessage): boolean {
  const expected = process.env.PI_CHAT_TOKEN;
  // 测试阶段未配置访问令牌时，直接复用本机 Pi 的授权；正式公网可再设置令牌。
  if (!expected) return true;
  const actual = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const forwarded = req.headers["x-forwarded-host"];
  const host = String(Array.isArray(forwarded) ? forwarded[0] : forwarded ?? req.headers.host ?? "");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function readBody(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > BODY_LIMIT) throw Object.assign(new Error("消息过长"), { status: 413 });
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Json;
  } catch {
    throw Object.assign(new Error("无效 JSON"), { status: 400 });
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function stateResponse(session: PiProcess): Promise<Json> {
  const state = await session.state();
  const models = await session.request({ type: "get_available_models" });
  const messages = await session.request({ type: "get_messages" });
  const modelData = ((models.data as Json | undefined)?.models as unknown[] | undefined) ?? [];
  return {
    session: session.key,
    model: modelSummary(state.model),
    thinkingLevel: state.thinkingLevel,
    models: modelData.map(modelSummary).filter(Boolean),
    messages: normalizeMessages((messages.data as Json | undefined)?.messages),
  };
}

async function streamPrompt(
  session: PiProcess,
  message: string,
  images: PromptImage[],
  res: ServerResponse,
): Promise<void> {
  if (session.busy) throw Object.assign(new Error("Pi 正在回复"), { status: 409 });
  session.busy = true;
  let finished = false;
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  const line = (value: unknown) => res.write(`${JSON.stringify(value)}\n`);
  let resolveEnd!: () => void;
  let rejectEnd!: (error: Error) => void;
  const ended = new Promise<void>((resolvePromise, rejectPromise) => {
    resolveEnd = resolvePromise;
    rejectEnd = rejectPromise;
  });
  const listener: Listener = (event) => {
    if (event.type === "message_update") {
      const update = event.assistantMessageEvent as Json | undefined;
      if (update?.type === "text_delta") line({ type: "delta", delta: update.delta });
      if (update?.type === "thinking_delta") line({ type: "thinking", delta: update.delta });
    } else if (event.type === "agent_end") {
      finished = true;
      resolveEnd();
    } else if (event.type === "rpc_error") {
      rejectEnd(new Error(String(event.error)));
    }
  };
  session.listeners.add(listener);
  res.once("close", () => {
    if (!finished) void session.request({ type: "abort" }).catch(() => undefined);
  });

  try {
    await session.request({ type: "prompt", message, ...(images.length ? { images } : {}) });
    await ended;
    line({ type: "done" });
    res.end();
  } catch (error) {
    line({ type: "error", error: error instanceof Error ? error.message : String(error) });
    res.end();
  } finally {
    finished = true;
    session.busy = false;
    session.lastUsed = Date.now();
    session.listeners.delete(listener);
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
  if (!sameOrigin(req)) return json(res, 403, { error: "cross-origin request denied" });
  if (!allowRequest(req)) return json(res, 429, { error: "请求过于频繁" });
  if (!authorized(req)) return json(res, 401, { error: "需要 Pi Chat 访问令牌" });

  try {
    await mkdir(SESSION_DIR, { recursive: true });
    const body = await readBody(req);
    const action = body.action;
    if (body.session !== undefined && typeof body.session !== "string") {
      throw Object.assign(new Error("无效会话"), { status: 400 });
    }
    if (action === "state") return json(res, 200, await stateResponse(await getSession(body.session)));
    if (!["prompt", "abort", "model", "thinking", "delete"].includes(String(action))) {
      throw Object.assign(new Error("未知操作"), { status: 400 });
    }

    const session = await getSession(body.session);
    if (action === "prompt") {
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message) throw Object.assign(new Error("消息不能为空"), { status: 400 });
      return await streamPrompt(session, message, normalizePromptImages(body.images), res);
    }
    if (action === "abort") {
      await session.request({ type: "abort" });
      return json(res, 200, { ok: true });
    }
    if (action === "model") {
      if (typeof body.provider !== "string" || typeof body.modelId !== "string") {
        throw Object.assign(new Error("无效模型"), { status: 400 });
      }
      await session.request({ type: "set_model", provider: body.provider, modelId: body.modelId });
      return json(res, 200, await stateResponse(session));
    }
    if (action === "thinking") {
      if (typeof body.level !== "string" || !THINKING_LEVELS.has(body.level)) {
        throw Object.assign(new Error("无效思考级别"), { status: 400 });
      }
      await session.request({ type: "set_thinking_level", level: body.level });
      return json(res, 200, { thinkingLevel: body.level });
    }
    if (action === "delete") {
      const key = session.key ?? String(body.session);
      session.dispose();
      sessions.delete(key);
      await unlink(sessionPath(key)).catch(() => undefined);
      return json(res, 200, { ok: true });
    }
  } catch (error) {
    const status = Number((error as { status?: number }).status) || 500;
    json(res, status, { error: error instanceof Error ? error.message : String(error) });
  }
}

function attach(server: ViteDevServer | PreviewServer): void {
  server.middlewares.use((req, res, next) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (!piAgentRoute(pathname)) return next();
    void handle(req, res);
  });
  server.httpServer?.once("close", () => {
    for (const session of processes) session.dispose();
  });
}

/** Browser bridge to the locally authenticated Pi CLI. */
export function piAgentPlugin(): Plugin {
  return { name: "pi-agent", configureServer: attach, configurePreviewServer: attach };
}
