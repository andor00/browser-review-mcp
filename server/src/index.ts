import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { loadConfig, type Config } from './config.ts';
import { Store } from './store.ts';
import { Hub } from './hub.ts';
import { handleApi } from './api.ts';
import { createMcp } from './mcp.ts';
import { extensionAllowed, hostAllowed, mcpAllowed } from './security.ts';

/** From package.json, which scripts/version.ts keeps in step with the root version. */
export const VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

function deny(res: ServerResponse, why: string): void {
  res.writeHead(403, { 'content-type': 'text/plain' });
  res.end(why);
}

export function startServer(config: Config) {
  const store = new Store(config.dataDir);
  const hub = new Hub(VERSION);
  const mcp = createMcp(store, hub, VERSION);
  const mcpNode = toNodeHandler(mcp);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (!hostAllowed(req, config.port)) return deny(res, 'Host not allowed.');
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (url.pathname === '/mcp') {
      if (!mcpAllowed(req)) return deny(res, 'MCP is only for local clients, not browsers.');
      await mcpNode(req, res);
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      if (!extensionAllowed(req)) return deny(res, 'Origin not allowed.');
      await handleApi(req, res, url, store, hub, VERSION);
      return;
    }

    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`Browser Review server ${VERSION}\nMCP: http://127.0.0.1:${config.port}/mcp\n`);
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found.');
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/ws' || !hostAllowed(req, config.port) || !extensionAllowed(req)) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    hub.handleUpgrade(req, socket, head);
  });

  const close = async () => {
    hub.close();
    await mcp.close();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  };

  return { server, store, hub, close };
}

if (import.meta.main) {
  const config = loadConfig();
  const { server, close } = startServer(config);
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${config.port} is already in use. Is the review server already running?`);
      process.exit(1);
    }
    throw err;
  });
  server.listen(config.port, config.host, () => {
    console.log(`Browser Review server ${VERSION}`);
    console.log(`  extension API  http://${config.host}:${config.port}/api`);
    console.log(`  MCP            http://${config.host}:${config.port}/mcp`);
    console.log(`  data           ${config.dataDir}`);
  });
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      void close().then(() => process.exit(0));
    });
  }
}
