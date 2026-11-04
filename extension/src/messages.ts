// Messages between the content script and the background service worker.
import type { Comment, Rect, TargetInfo, Viewport } from '@brm/shared';

export type ApiMethod = 'GET' | 'POST' | 'DELETE';

/** Content script -> background (chrome.runtime.sendMessage). */
export type ContentRequest =
  | { type: 'api'; method: ApiMethod; path: string; body?: unknown }
  | { type: 'capture'; rect: Rect | null; viewport: Viewport }
  | { type: 'screenshot-data'; id: number };

export type ApiResponse<T = unknown> =
  | { ok: true; data: T; offline?: false }
  | { ok: true; data: T; offline: true }
  | { ok: false; status: number; error: string; offline: boolean };

export type CaptureResponse = { ok: true; page: string; element: string | null } | { ok: false; error: string };

export type ScreenshotDataResponse = { ok: true; dataUrl: string } | { ok: false; error: string };

/** Background -> content script over the long-lived port. */
export type PortEvent =
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
