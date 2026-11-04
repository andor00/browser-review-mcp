// Content script side of the messaging with the background worker, which owns the data.
import type { CreateCommentInput, Rect, ScreenshotUpload } from '@brm/shared';
import type {
  CaptureResponse,
  ContentRequest,
  PortEvent,
  ScreenshotDataResponse,
  StoreOp,
  StoreOps,
  StoreResponse,
} from '../messages.ts';

export class ApiError extends Error {}

function sendMessage<T>(req: ContentRequest): Promise<T> {
  return chrome.runtime.sendMessage(req) as Promise<T>;
}

async function op<K extends StoreOp>(name: K, args: StoreOps[K]['args']): Promise<StoreOps[K]['result']> {
  let res: StoreResponse<StoreOps[K]['result']>;
  try {
    res = await sendMessage({ type: 'store', op: name, args });
  } catch {
    throw new ApiError('The extension was reloaded. Reload this page.');
  }
  if (!res.ok) throw new ApiError(res.error);
  return res.data;
}

export const bridge = {
  listComments: (origin: string) => op('list', { origin }),
  createComment: (input: CreateCommentInput) => op('create', input),
  reply: (id: number, body: string) => op('reply', { id, body }),
  accept: (id: number) => op('accept', { id }),
  reopen: (id: number, body?: string) => op('reopen', { id, body }),
  remove: async (id: number) => {
    await op('delete', { id });
  },
  openHelp: (section?: string) => void sendMessage({ type: 'open-help', section }).catch(() => {}),

  async screenshot(id: number): Promise<string | null> {
    try {
      const res = await sendMessage<ScreenshotDataResponse>({ type: 'screenshot-data', id });
      return res.ok ? res.dataUrl : null;
    } catch {
      return null;
    }
  },

  async capture(rect: Rect | null): Promise<ScreenshotUpload | undefined> {
    try {
      const res = await sendMessage<CaptureResponse>({
        type: 'capture',
        rect,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      });
      if (!res.ok) return undefined;
      return res.element ? { page: res.page, element: res.element } : { page: res.page };
    } catch {
      return undefined;
    }
  },

  /** Live events from the background. Reconnects when the service worker restarts. */
  subscribe(onEvent: (ev: PortEvent) => void): () => void {
    let port: chrome.runtime.Port | null = null;
    let stopped = false;
    const open = () => {
      if (stopped) return;
      try {
        port = chrome.runtime.connect({ name: 'brm' });
      } catch {
        onEvent({ type: 'status', connected: false });
        return; // extension context is gone (extension reloaded)
      }
      port.onMessage.addListener((ev: PortEvent) => onEvent(ev));
      port.onDisconnect.addListener(() => {
        port = null;
        setTimeout(open, 1000);
      });
    };
    open();
    return () => {
      stopped = true;
      port?.disconnect();
    };
  },
};
