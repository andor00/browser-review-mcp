// Background service worker: the only part that talks to the review server.
// Content scripts go through here, so the page's CSP and CORS never get in the way.
import { DEFAULT_PORT, pageKey, type Comment, type ExtensionToServer, type Rect, type ServerToExtension, type Viewport } from '@brm/shared';
import type {
  ApiResponse,
  CaptureResponse,
  ContentRequest,
  PortEvent,
  PrepareCaptureResponse,
  ScreenshotDataResponse,
  TabRequest,
} from './messages.ts';

const BASE = `http://127.0.0.1:${DEFAULT_PORT}`;
const WS_URL = `ws://127.0.0.1:${DEFAULT_PORT}/ws`;
const LOCAL_TABS = ['http://localhost/*', 'http://127.0.0.1/*'];

// ---------- WebSocket to the server ----------

let ws: WebSocket | null = null;
let connected = false;
let retryMs = 1000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const ports = new Set<chrome.runtime.Port>();

function setConnected(value: boolean): void {
  if (connected === value) return;
  connected = value;
  broadcast({ type: 'status', connected });
  void chrome.action.setBadgeText({ text: connected ? '' : '!' });
  void chrome.action.setBadgeBackgroundColor({ color: '#8a8f98' });
}

function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  const socket = new WebSocket(WS_URL);
  ws = socket;
  socket.onopen = () => {
    retryMs = 1000;
    setConnected(true);
  };
  socket.onmessage = (ev) => {
    let msg: ServerToExtension;
    try {
      msg = JSON.parse(String(ev.data)) as ServerToExtension;
    } catch {
      return;
    }
    void onServerMessage(msg);
  };
  socket.onclose = () => {
    if (ws === socket) ws = null;
    setConnected(false);
    retryTimer = setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 10_000);
  };
  socket.onerror = () => socket.close();
}

function send(msg: ExtensionToServer): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

async function onServerMessage(msg: ServerToExtension): Promise<void> {
  switch (msg.type) {
    case 'ping':
      send({ type: 'pong' });
      break;
    case 'comments-changed':
      broadcast({ type: 'comments-changed', origin: msg.origin });
      break;
    case 'capture-request':
      try {
        const res = await captureForComment(msg.comment);
        send({ type: 'capture-result', requestId: msg.requestId, ok: true, ...res });
      } catch (err) {
        send({
          type: 'capture-result',
          requestId: msg.requestId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    case 'hello':
      break;
  }
}

function broadcast(ev: PortEvent): void {
  for (const p of ports) {
    try {
      p.postMessage(ev);
    } catch {
      ports.delete(p);
    }
  }
}

// The service worker can be stopped by the browser. Alarms wake it up so it reconnects.
chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => connect());
chrome.runtime.onStartup.addListener(() => connect());
chrome.runtime.onInstalled.addListener(() => connect());
connect();

// ---------- content script connections ----------

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'brm') return;
  ports.add(port);
  port.postMessage({ type: 'status', connected } satisfies PortEvent);
  port.onDisconnect.addListener(() => ports.delete(port));
  connect();
});

chrome.runtime.onMessage.addListener((req: ContentRequest, sender, sendResponse) => {
  if (req.type === 'api') {
    void callApi(req.method, req.path, req.body).then(sendResponse);
    return true;
  }
  if (req.type === 'capture') {
    const windowId = sender.tab?.windowId;
    if (windowId === undefined) {
      sendResponse({ ok: false, error: 'No tab.' } satisfies CaptureResponse);
      return false;
    }
    void capture(windowId, req.rect, req.viewport)
      .then((r): CaptureResponse => ({ ok: true, ...r }))
      .catch((err: unknown): CaptureResponse => ({ ok: false, error: String(err) }))
      .then(sendResponse);
    return true;
  }
  if (req.type === 'screenshot-data') {
    void screenshotData(req.id).then(sendResponse);
    return true;
  }
  return false;
});

// ---------- API proxy with an offline cache for comment lists ----------

async function callApi(method: string, path: string, body?: unknown): Promise<ApiResponse> {
  const cacheKey = method === 'GET' && path.startsWith('/api/comments?') ? `cache:${path}` : null;
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const error = (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
      return { ok: false, status: res.status, error, offline: false };
    }
    if (cacheKey) await chrome.storage.local.set({ [cacheKey]: data });
    return { ok: true, data };
  } catch {
    connect();
    if (cacheKey) {
      const cached = (await chrome.storage.local.get(cacheKey))[cacheKey];
      if (cached !== undefined) return { ok: true, data: cached, offline: true };
    }
    return {
      ok: false,
      status: 0,
      error: 'The review server is not running. Start it with: pnpm server',
      offline: true,
    };
  }
}

async function screenshotData(id: number): Promise<ScreenshotDataResponse> {
  try {
    const res = await fetch(`${BASE}/api/screenshots/${id}`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, dataUrl: toDataUrl(new Uint8Array(await res.arrayBuffer())) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------- screenshots ----------

function toDataUrl(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(bin)}`;
}

let lastCapture = 0;

/** Visible-tab screenshot plus an optional crop around rect (CSS pixels). */
async function capture(windowId: number, rect: Rect | null, viewport: Viewport): Promise<{ page: string; element: string | null }> {
  // captureVisibleTab is limited to 2 calls per second.
  const wait = lastCapture + 600 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCapture = Date.now();
  const page = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  if (!rect || rect.width <= 0 || rect.height <= 0) return { page, element: null };

  const bitmap = await createImageBitmap(await (await fetch(page)).blob());
  const scale = bitmap.width / viewport.width;
  const pad = 12;
  const x0 = Math.max(0, Math.floor((rect.x - pad) * scale));
  const y0 = Math.max(0, Math.floor((rect.y - pad) * scale));
  const x1 = Math.min(bitmap.width, Math.ceil((rect.x + rect.width + pad) * scale));
  const y1 = Math.min(bitmap.height, Math.ceil((rect.y + rect.height + pad) * scale));
  if (x1 - x0 < 2 || y1 - y0 < 2) return { page, element: null };
  const canvas = new OffscreenCanvas(x1 - x0, y1 - y0);
  const ctx = canvas.getContext('2d');
  if (!ctx) return { page, element: null };
  ctx.drawImage(bitmap, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return { page, element: toDataUrl(new Uint8Array(await blob.arrayBuffer())) };
}

/** Live screenshot asked for by Claude over MCP. */
async function captureForComment(c: Comment): Promise<{ page: string; element: string | null; note: string | null }> {
  const tabs = await chrome.tabs.query({ url: LOCAL_TABS });
  const matching = tabs.filter((t) => {
    if (!t.url || t.id === undefined) return false;
    const k = pageKey(t.url);
    return k.origin === c.origin && k.path === c.path;
  });
  const tab = matching.find((t) => t.active) ?? matching[0];
  if (!tab?.id || tab.windowId === undefined) {
    throw new Error(`No open tab on ${c.origin}${c.path}. Ask the user to open that page in Brave.`);
  }
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  await new Promise((r) => setTimeout(r, 300));

  let prep: PrepareCaptureResponse | null = null;
  try {
    prep = (await chrome.tabs.sendMessage(tab.id, { type: 'prepare-capture', comment: c } satisfies TabRequest)) as PrepareCaptureResponse;
  } catch {
    prep = null;
  }
  try {
    const viewport = prep?.viewport ?? { width: tab.width ?? 1, height: tab.height ?? 1, dpr: 1 };
    const shot = await capture(tab.windowId, prep?.rect ?? null, viewport);
    const note = prep ? prep.note : 'The overlay is not loaded in that tab (reload the page), so the element could not be located.';
    return { ...shot, note };
  } finally {
    if (prep) void chrome.tabs.sendMessage(tab.id, { type: 'capture-done' } satisfies TabRequest).catch(() => {});
  }
}

// ---------- toggle ----------

async function toggle(tabId: number | undefined): Promise<void> {
  if (tabId === undefined) return;
  await chrome.tabs.sendMessage(tabId, { type: 'toggle' } satisfies TabRequest).catch(() => {});
}

chrome.action.onClicked.addListener((tab) => void toggle(tab.id));
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-overlay') void toggle(tab?.id);
});
