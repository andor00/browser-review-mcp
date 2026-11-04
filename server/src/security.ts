import type { IncomingMessage } from 'node:http';

/**
 * The server binds to 127.0.0.1, but a website open in the browser can still
 * send requests to 127.0.0.1. These checks make sure only the extension, local
 * tools (curl, Claude Code) and nothing else get in.
 */

/** Blocks DNS rebinding: the Host header must be the loopback address we listen on. */
export function hostAllowed(req: IncomingMessage, port: number): boolean {
  const host = req.headers.host;
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

function isExtensionOrigin(origin: string): boolean {
  return origin.startsWith('chrome-extension://');
}

/**
 * Extension API and WebSocket. Allowed:
 * - requests with an extension Origin (POST, DELETE, WebSocket from the extension)
 * - requests without Origin that a website can't make:
 *   - Sec-Fetch-Site "none": the extension's own GET requests (Chrome leaves out
 *     Origin there) or the user typing the URL in the address bar
 *   - no Sec-Fetch-Site at all: not a browser (curl, scripts)
 * A website always gets "cross-site" or "same-site", also for <img> tags.
 */
export function extensionAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin) return isExtensionOrigin(origin);
  const site = req.headers['sec-fetch-site'];
  return site === undefined || site === 'none';
}

/** MCP endpoint: only non-browser clients like Claude Code. */
export function mcpAllowed(req: IncomingMessage): boolean {
  return req.headers.origin === undefined && req.headers['sec-fetch-site'] === undefined;
}
