// Content script side of the messaging with the background worker.
import type { Comment, CreateCommentInput, Rect, ScreenshotUpload } from '@brm/shared';
import type {
  ApiMethod,
  ApiResponse,
  CaptureResponse,
  ContentRequest,
  PortEvent,
  ScreenshotDataResponse,
} from '../messages.ts';

export class ApiError extends Error {
  readonly offline: boolean;
  constructor(message: string, offline: boolean) {
    super(message);
    this.offline = offline;
  }
}

function sendMessage<T>(req: ContentRequest): Promise<T> {
  return chrome.runtime.sendMessage(req) as Promise<T>;
}

async function api<T>(method: ApiMethod, path: string, body?: unknown): Promise<{ data: T; offline: boolean }> {
  let res: ApiResponse<T>;
  try {
    res = await sendMessage<ApiResponse<T>>({ type: 'api', method, path, body });
  } catch {
    throw new ApiError('The extension was reloaded. Reload this page.', true);
  }
  if (!res.ok) throw new ApiError(res.error, res.offline);
  return { data: res.data, offline: res.offline === true };
}

export const bridge = {
  listComments: (origin: string) => api<Comment[]>('GET', `/api/comments?origin=${encodeURIComponent(origin)}`),
  createComment: async (input: CreateCommentInput) => (await api<Comment>('POST', '/api/comments', input)).data,
  reply: async (id: number, body: string) => (await api<Comment>('POST', `/api/comments/${id}/messages`, { body })).data,
  accept: async (id: number) => (await api<Comment>('POST', `/api/comments/${id}/accept`)).data,
  reopen: async (id: number, body?: string) => (await api<Comment>('POST', `/api/comments/${id}/reopen`, { body })).data,
  remove: async (id: number) => {
    await api<{ ok: true }>('DELETE', `/api/comments/${id}`);
  },

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
