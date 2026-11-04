import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Comment, ExtensionToServer, ServerToExtension } from '@brm/shared';

export interface CaptureResult {
  page: string;
  element: string | null;
  note: string | null;
}

interface Pending {
  resolve: (r: CaptureResult) => void;
  reject: (e: Error) => void;
  waitingFor: Set<WebSocket>;
  errors: string[];
  timer: NodeJS.Timeout;
}

/**
 * Keeps the WebSocket connections to the extension background worker.
 * Pushes "something changed" events and relays live screenshot requests.
 */
export class Hub {
  readonly #wss = new WebSocketServer({ noServer: true, maxPayload: 50 * 1024 * 1024 });
  readonly #sockets = new Set<WebSocket>();
  readonly #pending = new Map<string, Pending>();
  readonly #version: string;
  readonly #pingTimer: NodeJS.Timeout;

  constructor(version: string) {
    this.#version = version;
    // MV3 service workers sleep after ~30s without events. A ping every 20s keeps it awake.
    this.#pingTimer = setInterval(() => this.broadcast({ type: 'ping' }), 20_000);
    this.#pingTimer.unref();
  }

  get connected(): number {
    return this.#sockets.size;
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.#wss.handleUpgrade(req, socket, head, (ws) => this.#onConnection(ws));
  }

  #onConnection(ws: WebSocket): void {
    this.#sockets.add(ws);
    this.#send(ws, { type: 'hello', version: this.#version });
    ws.on('message', (data) => {
      let msg: ExtensionToServer;
      try {
        msg = JSON.parse(String(data)) as ExtensionToServer;
      } catch {
        return;
      }
      if (msg.type === 'capture-result') this.#onCaptureResult(ws, msg);
    });
    ws.on('close', () => {
      this.#sockets.delete(ws);
      for (const [id, p] of this.#pending) {
        if (p.waitingFor.delete(ws)) {
          p.errors.push('Extension disconnected.');
          this.#maybeFail(id, p);
        }
      }
    });
    ws.on('error', () => ws.close());
  }

  broadcast(msg: ServerToExtension): void {
    for (const ws of this.#sockets) this.#send(ws, msg);
  }

  commentsChanged(origin: string): void {
    this.broadcast({ type: 'comments-changed', origin });
  }

  /** Asks every connected extension for a fresh screenshot. The first good answer wins. */
  requestCapture(comment: Comment, timeoutMs = 20_000): Promise<CaptureResult> {
    if (this.#sockets.size === 0) {
      return Promise.reject(
        new Error('The browser extension is not connected. Is Brave open with the extension loaded?'),
      );
    }
    const requestId = randomUUID();
    return new Promise<CaptureResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error(`No screenshot from the extension within ${timeoutMs / 1000}s.`));
      }, timeoutMs);
      this.#pending.set(requestId, {
        resolve,
        reject,
        waitingFor: new Set(this.#sockets),
        errors: [],
        timer,
      });
      this.broadcast({ type: 'capture-request', requestId, comment });
    });
  }

  #onCaptureResult(ws: WebSocket, msg: Extract<ExtensionToServer, { type: 'capture-result' }>): void {
    const p = this.#pending.get(msg.requestId);
    if (!p) return;
    p.waitingFor.delete(ws);
    if (msg.ok) {
      clearTimeout(p.timer);
      this.#pending.delete(msg.requestId);
      p.resolve({ page: msg.page, element: msg.element, note: msg.note });
    } else {
      p.errors.push(msg.error);
      this.#maybeFail(msg.requestId, p);
    }
  }

  #maybeFail(id: string, p: Pending): void {
    if (p.waitingFor.size > 0) return;
    clearTimeout(p.timer);
    this.#pending.delete(id);
    p.reject(new Error([...new Set(p.errors)].join(' ')));
  }

  #send(ws: WebSocket, msg: ServerToExtension): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  close(): void {
    clearInterval(this.#pingTimer);
    for (const ws of this.#sockets) ws.terminate();
    this.#wss.close();
  }
}
