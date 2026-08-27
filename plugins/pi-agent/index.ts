import { renderMarkdown } from "./markdown";

interface ChatModel {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
  thinkingLevelMap?: Record<string, string>;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
}

interface PromptImage {
  type: "image";
  data: string;
  mimeType: "image/jpeg";
}

interface ChatState {
  session: string;
  model: ChatModel | null;
  thinkingLevel: string;
  models: ChatModel[];
  messages: ChatMessage[];
}

interface Conversation {
  session: string;
  title: string;
  updatedAt: number;
}

const API = "api/pi-agent";
const HISTORY_KEY = "geolibre:pi-chat-history";
const ACTIVE_KEY = "geolibre:pi-chat-active";
const TOKEN_KEY = "geolibre:pi-chat-token";
const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function byId<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value as T;
}

function storedHistory(): Conversation[] {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as Conversation[];
    return value.filter((x) => typeof x.session === "string" && typeof x.title === "string");
  } catch {
    return [];
  }
}

function saveHistory(history: Conversation[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 50)));
}

async function request(body: Record<string, unknown>, retry = true): Promise<Response> {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const response = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (response.status === 401 && retry) {
    const value = prompt("请输入 Pi Chat 访问令牌");
    if (value) {
      sessionStorage.setItem(TOKEN_KEY, value);
      return request(body, false);
    }
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
    throw new ApiError(response.status, data.error ?? "Pi Chat 请求失败");
  }
  return response;
}

async function jsonRequest<T>(body: Record<string, unknown>): Promise<T> {
  return request(body).then((response) => response.json() as Promise<T>);
}

function messageView(message: ChatMessage): HTMLElement {
  const article = document.createElement("article");
  article.className = `pi-message ${message.role}`;
  if (message.thinking) {
    const details = document.createElement("details");
    details.className = "pi-thinking";
    details.innerHTML = `<summary>思考过程</summary><div class="markdown">${renderMarkdown(message.thinking)}</div>`;
    article.append(details);
  }
  const body = document.createElement("div");
  body.className = "markdown";
  body.innerHTML = renderMarkdown(message.content);
  article.append(body);
  return article;
}

/** Bind the ChatGPT-like right panel to the local Pi RPC bridge. */
export function bindPiAgent(resizeMap: () => void): void {
  const shell = byId<HTMLElement>("app-shell");
  const panel = byId<HTMLElement>("pi-chat");
  const toggle = byId<HTMLButtonElement>("toggle-pi-chat");
  const close = byId<HTMLButtonElement>("pi-chat-close");
  const newButton = byId<HTMLButtonElement>("pi-chat-new");
  const historyToggle = byId<HTMLButtonElement>("pi-chat-history-toggle");
  const share = byId<HTMLButtonElement>("pi-chat-share");
  const historyPane = byId<HTMLElement>("pi-chat-history");
  const messages = byId<HTMLElement>("pi-chat-messages");
  const form = byId<HTMLFormElement>("pi-chat-form");
  const input = byId<HTMLTextAreaElement>("pi-chat-input");
  const send = byId<HTMLButtonElement>("pi-chat-send");
  const modelSelect = byId<HTMLSelectElement>("pi-chat-model");
  const thinkingSelect = byId<HTMLSelectElement>("pi-chat-thinking");
  let history = storedHistory();
  let active: Conversation | undefined;
  let models: ChatModel[] = [];
  let running = false;
  let connecting = false;
  let screen: { stream: MediaStream; video: HTMLVideoElement } | undefined;

  const stopScreen = () => {
    const current = screen;
    screen = undefined;
    current?.stream.getTracks().forEach((track) => track.stop());
    if (current) current.video.srcObject = null;
    share.ariaPressed = "false";
    share.title = "共享当前界面给 Pi";
  };

  const startScreen = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("当前浏览器不支持界面共享");
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "browser", frameRate: { ideal: 1, max: 2 } },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
    } as DisplayMediaStreamOptions);
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    screen = { stream, video };
    share.ariaPressed = "true";
    share.title = "停止共享界面";
    stream.getVideoTracks()[0]?.addEventListener("ended", stopScreen, { once: true });
  };

  const captureScreen = async (): Promise<PromptImage | undefined> => {
    const video = screen?.video;
    if (!video) return undefined;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await new Promise<void>((resolve) => video.addEventListener("loadeddata", () => resolve(), { once: true }));
    }
    const scale = Math.min(1, 1600 / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context || !canvas.width || !canvas.height) throw new Error("无法读取共享界面");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return {
      type: "image",
      data: canvas.toDataURL("image/jpeg", 0.82).split(",")[1]!,
      mimeType: "image/jpeg",
    };
  };

  const setControlStatus = (label: string) => {
    models = [];
    modelSelect.replaceChildren(new Option(label, ""));
    thinkingSelect.replaceChildren(new Option("Think", ""));
    modelSelect.disabled = true;
    thinkingSelect.disabled = true;
  };

  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    shell.classList.toggle("pi-chat-open", open);
    toggle.ariaExpanded = String(open);
    toggle.ariaLabel = open ? "关闭 Pi Chat" : "打开 Pi Chat";
    toggle.dataset.tip = toggle.ariaLabel;
    requestAnimationFrame(resizeMap);
    if (open) void ensureActive();
    else stopScreen();
  };

  const setRunning = (value: boolean) => {
    running = value;
    send.textContent = value ? "■" : "↑";
    send.ariaLabel = value ? "停止生成" : "发送";
    modelSelect.disabled = value;
    thinkingSelect.disabled = value || !models.find((x) => `${x.provider}/${x.id}` === modelSelect.value)?.reasoning;
  };

  const persist = () => {
    history.sort((a, b) => b.updatedAt - a.updatedAt);
    saveHistory(history);
    if (active) localStorage.setItem(ACTIVE_KEY, active.session);
    renderHistory();
  };

  const renderHistory = () => {
    historyPane.replaceChildren();
    for (const item of history) {
      const row = document.createElement("div");
      row.className = `pi-history-item${item.session === active?.session ? " active" : ""}`;
      const open = document.createElement("button");
      open.type = "button";
      open.textContent = item.title;
      open.title = item.title;
      open.addEventListener("click", () => void openConversation(item.session));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.ariaLabel = `删除 ${item.title}`;
      remove.addEventListener("click", () => void deleteConversation(item));
      row.append(open, remove);
      historyPane.append(row);
    }
  };

  const renderMessages = (items: ChatMessage[]) => {
    messages.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "pi-chat-empty";
      empty.innerHTML = "<b>π</b><h2>有什么可以帮忙？</h2>";
      messages.append(empty);
      return;
    }
    for (const item of items) messages.append(messageView(item));
    messages.scrollTop = messages.scrollHeight;
  };

  const updateControls = (state: ChatState) => {
    models = state.models;
    if (!models.length) return setControlStatus("无可用模型");
    modelSelect.replaceChildren(...models.map((model) => {
      const option = document.createElement("option");
      option.value = `${model.provider}/${model.id}`;
      option.textContent = `${model.name} · ${model.provider}`;
      return option;
    }));
    if (state.model) modelSelect.value = `${state.model.provider}/${state.model.id}`;
    modelSelect.disabled = running;
    updateThinking(state.thinkingLevel);
  };

  const updateThinking = (selected: string) => {
    const model = models.find((x) => `${x.provider}/${x.id}` === modelSelect.value);
    const levels = model?.reasoning
      ? THINKING.filter((level) => !["xhigh", "max"].includes(level) || level in (model.thinkingLevelMap ?? {}))
      : ["off"];
    thinkingSelect.replaceChildren(...levels.map((level) => {
      const option = document.createElement("option");
      option.value = level;
      option.textContent = level;
      return option;
    }));
    thinkingSelect.value = levels.includes(selected) ? selected : levels.at(-1)!;
    thinkingSelect.disabled = running || !model?.reasoning;
  };

  const openConversation = async (session?: string) => {
    if (running || connecting) return;
    connecting = true;
    setControlStatus("正在连接 Pi…");
    messages.innerHTML = '<div class="pi-chat-loading">正在连接 Pi…</div>';
    try {
      const state = await jsonRequest<ChatState>({ action: "state", ...(session ? { session } : {}) });
      active = history.find((x) => x.session === state.session);
      if (!active) {
        active = { session: state.session, title: "新对话", updatedAt: Date.now() };
        history.unshift(active);
      }
      updateControls(state);
      renderMessages(state.messages);
      persist();
      historyPane.hidden = true;
      historyToggle.ariaExpanded = "false";
      input.focus();
    } catch (error) {
      if (session && error instanceof ApiError && error.status === 404) {
        history = history.filter((x) => x.session !== session);
        saveHistory(history);
        connecting = false;
        return openConversation();
      }
      setControlStatus("连接失败");
      messages.innerHTML = `<div class="pi-chat-error">${renderMarkdown(error instanceof Error ? error.message : String(error))}</div>`;
    } finally {
      connecting = false;
    }
  };

  const ensureActive = async () => {
    if (active || connecting) return;
    const previous = localStorage.getItem(ACTIVE_KEY);
    await openConversation(history.some((x) => x.session === previous) ? previous! : history[0]?.session);
  };

  const deleteConversation = async (item: Conversation) => {
    if (running || !confirm(`删除对话“${item.title}”？`)) return;
    try {
      await jsonRequest({ action: "delete", session: item.session });
      history = history.filter((x) => x.session !== item.session);
      if (active?.session === item.session) active = undefined;
      persist();
      await openConversation(history[0]?.session);
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  };

  const streamReply = async (message: string, image?: PromptImage) => {
    if (!active) return;
    const assistant: ChatMessage = { role: "assistant", content: "" };
    const article = messageView(assistant);
    messages.append(article);
    const body = article.querySelector<HTMLElement>(".markdown")!;
    let thinkingBody: HTMLElement | undefined;
    const response = await request({
      action: "prompt",
      session: active.session,
      message,
      ...(image ? { images: [image] } : {}),
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("浏览器不支持流式响应");
    const decoder = new TextDecoder();
    let buffer = "";

    const consume = (line: string) => {
      if (!line) return;
      const event = JSON.parse(line) as { type: string; delta?: string; error?: string };
      if (event.type === "delta") {
        assistant.content += event.delta ?? "";
        // ponytail: 流式响应逐段重绘；超长回复出现卡顿时再节流。
        body.innerHTML = renderMarkdown(assistant.content);
      } else if (event.type === "thinking") {
        assistant.thinking = (assistant.thinking ?? "") + (event.delta ?? "");
        if (!thinkingBody) {
          const details = document.createElement("details");
          details.className = "pi-thinking";
          details.innerHTML = '<summary>思考过程</summary><div class="markdown"></div>';
          thinkingBody = details.lastElementChild as HTMLElement;
          article.prepend(details);
        }
        thinkingBody.innerHTML = renderMarkdown(assistant.thinking);
      } else if (event.type === "error") {
        throw new Error(event.error ?? "Pi 回复失败");
      }
      messages.scrollTop = messages.scrollHeight;
    };

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) consume(line);
      if (done) break;
    }
    consume(buffer);
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (running) {
      if (active) await jsonRequest({ action: "abort", session: active.session }).catch(() => undefined);
      return;
    }
    const text = input.value.trim();
    if (!text) return;
    await ensureActive();
    if (!active) return;
    let image: PromptImage | undefined;
    try {
      image = await captureScreen();
    } catch (error) {
      stopScreen();
      alert(error instanceof Error ? error.message : String(error));
    }
    messages.querySelector(".pi-chat-empty")?.remove();
    const userMessage = messageView({ role: "user", content: text });
    if (image) {
      const attached = document.createElement("small");
      attached.className = "pi-ui-attached";
      attached.textContent = "● 已附加当前界面";
      userMessage.append(attached);
    }
    messages.append(userMessage);
    input.value = "";
    input.style.height = "auto";
    if (active.title === "新对话") active.title = text.replace(/\s+/g, " ").slice(0, 36);
    active.updatedAt = Date.now();
    persist();
    setRunning(true);
    try {
      await streamReply(text, image);
    } catch (error) {
      messages.append(messageView({ role: "assistant", content: `**错误：** ${error instanceof Error ? error.message : String(error)}` }));
    } finally {
      setRunning(false);
      input.focus();
    }
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  });
  modelSelect.addEventListener("change", async () => {
    if (!active) return;
    const [provider, ...id] = modelSelect.value.split("/");
    try {
      const state = await jsonRequest<ChatState>({ action: "model", session: active.session, provider, modelId: id.join("/") });
      updateControls(state);
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  });
  thinkingSelect.addEventListener("change", async () => {
    if (!active) return;
    try {
      await jsonRequest({ action: "thinking", session: active.session, level: thinkingSelect.value });
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  });
  messages.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-copy-code]");
    const code = button?.parentElement?.nextElementSibling?.textContent;
    if (button && code) void navigator.clipboard.writeText(code).then(() => {
      button.textContent = "已复制";
      setTimeout(() => { button.textContent = "复制"; }, 1200);
    });
  });

  toggle.addEventListener("click", () => setOpen(panel.hasAttribute("hidden")));
  close.addEventListener("click", () => setOpen(false));
  share.addEventListener("click", async () => {
    if (screen) return stopScreen();
    try {
      await startScreen();
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  });
  newButton.addEventListener("click", () => void openConversation());
  historyToggle.addEventListener("click", () => {
    historyPane.hidden = !historyPane.hidden;
    historyToggle.ariaExpanded = String(!historyPane.hidden);
  });
  renderHistory();
}
