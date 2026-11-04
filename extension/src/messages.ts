// Messages between the content script / extension pages and the background service worker.
import type { Comment, CreateCommentInput, Rect, TargetInfo, Viewport } from '@brm/shared';

/** Store operations the overlay can ask the background for. */
export interface StoreOps {
  list: { args: { origin: string }; result: Comment[] };
  create: { args: CreateCommentInput; result: Comment };
  reply: { args: { id: number; body: string }; result: Comment };
  accept: { args: { id: number }; result: Comment };
  reopen: { args: { id: number; body?: string }; result: Comment };
  delete: { args: { id: number }; result: null };
}
export type StoreOp = keyof StoreOps;

/** Content script or extension page -> background (chrome.runtime.sendMessage). */
export type ContentRequest =
  | { type: 'store'; op: StoreOp; args: unknown }
  | { type: 'capture'; rect: Rect | null; viewport: Viewport }
  | { type: 'screenshot-data'; id: number }
  | { type: 'open-help'; section?: string }
  | { type: 'status' };

export type StoreResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

/** Answer to { type: 'status' }. */
export interface StatusResponse {
  /** A Claude Code session with the browser-review MCP server is connected. */
  claude: boolean;
  /** Version of the MCP server, when connected. */
  mcpVersion: string | null;
  version: string;
}

export type CaptureResponse = { ok: true; page: string; element: string | null } | { ok: false; error: string };

export type ScreenshotDataResponse = { ok: true; dataUrl: string } | { ok: false; error: string };

/** Background -> content script over the long-lived port. */
export type PortEvent =
  /** connected: a Claude Code session is connected. */
  | { type: 'status'; connected: boolean }
  | { type: 'comments-changed'; origin: string };

/** Background -> content script (chrome.tabs.sendMessage). */
export type TabRequest =
  | { type: 'toggle' }
  | { type: 'command'; command: OverlayCommand }
  | { type: 'prepare-capture'; comment: Comment }
  | { type: 'capture-done' };

/** Keyboard shortcuts (manifest "commands") handled by the overlay. */
export type OverlayCommand = 'pick-element' | 'page-comment' | 'toggle-threads';

export interface PrepareCaptureResponse {
  rect: Rect | null;
  viewport: Viewport;
  note: string | null;
}

export type { TargetInfo };
