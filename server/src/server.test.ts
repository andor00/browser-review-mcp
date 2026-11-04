import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import WebSocket from 'ws';
import type { Comment, CreateCommentInput, ServerToExtension } from '@brm/shared';
import { startServer } from './index.ts';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function tinyPng(): string {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

const port = 40000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;
const ext = { origin: 'chrome-extension://testextension' };
let dataDir: string;
let app: ReturnType<typeof startServer>;

async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(base + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...ext, ...(init.headers as Record<string, string>) },
  });
  const type = res.headers.get('content-type') ?? '';
  const body = (type.includes('json') ? await res.json() : await res.text()) as T;
  return { status: res.status, body };
}

const removeInput: CreateCommentInput = {
  kind: 'remove',
  url: 'http://localhost:5173/cases/12/?tab=2',
  title: 'Zaak 12',
  viewport: { width: 1440, height: 900, dpr: 1 },
  target: {
    selectors: ['[data-testid="save"]', 'main > button:nth-of-type(2)'],
    tag: 'button',
    text: 'Opslaan',
    html: '<button data-testid="save">Opslaan</button>',
    rect: { x: 10, y: 20, width: 80, height: 32 },
    components: ['CasePage', 'Toolbar'],
    source: 'src/features/case/Toolbar.tsx:12',
  },
  change: { kind: 'remove' },
  body: '',
  screenshots: { page: tinyPng(), element: tinyPng() },
};

async function mcpClient(): Promise<Client> {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  return client;
}

function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text?: string }[] }).content;
  return content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'brm-test-'));
  app = startServer({ port, host: '127.0.0.1', dataDir });
  await new Promise<void>((r) => app.server.listen(port, '127.0.0.1', () => r()));
});

after(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('security', () => {
  it('rejects a wrong Host header', async () => {
    // fetch() does not allow overriding Host, node:http does.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      request(`${base}/api/health`, { headers: { host: `evil.example:${port}` } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
        .on('error', reject)
        .end();
    });
    assert.equal(status, 403);
  });

  it('rejects website origins on the API', async () => {
    const res = await fetch(`${base}/api/comments`, { headers: { origin: 'http://localhost:5173' } });
    assert.equal(res.status, 403);
  });

  it('rejects browser requests without Origin (like <img>)', async () => {
    const res = await fetch(`${base}/api/health`, { headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(res.status, 403);
  });

  it('allows extension GETs, which come without Origin but with Sec-Fetch-Site none', async () => {
    const res = await fetch(`${base}/api/health`, { headers: { 'sec-fetch-site': 'none' } });
    assert.equal(res.status, 200);
  });

  it('rejects same-site browser requests from another localhost app', async () => {
    const res = await fetch(`${base}/api/health`, { headers: { 'sec-fetch-site': 'same-site' } });
    assert.equal(res.status, 403);
  });

  it('rejects browser origins on MCP', async () => {
    const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { origin: 'chrome-extension://x' } });
    assert.equal(res.status, 403);
  });

  it('allows the extension and plain local clients', async () => {
    assert.equal((await api('/api/health')).status, 200);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  });

  it('only accepts localhost pages', async () => {
    const res = await api('/api/comments', {
      method: 'POST',
      body: JSON.stringify({ ...removeInput, url: 'https://example.com/' }),
    });
    assert.equal(res.status, 400);
  });
});

describe('comment flow', () => {
  let id: number;

  it('creates a remove comment with screenshots, grouped by path', async () => {
    const res = await api<Comment>('/api/comments', { method: 'POST', body: JSON.stringify(removeInput) });
    assert.equal(res.status, 201);
    id = res.body.id;
    assert.equal(res.body.status, 'open');
    assert.equal(res.body.origin, 'http://localhost:5173');
    assert.equal(res.body.path, '/cases/12');
    assert.equal(res.body.screenshots.length, 2);
    assert.equal(res.body.messages[0]?.body, 'Remove this element.');

    const shot = await fetch(`${base}/api/screenshots/${res.body.screenshots[0]!.id}`, { headers: ext });
    assert.equal(shot.headers.get('content-type'), 'image/png');
  });

  it('rejects a plain comment without text', async () => {
    const res = await api('/api/comments', {
      method: 'POST',
      body: JSON.stringify({ ...removeInput, kind: 'comment', change: null, body: '  ' }),
    });
    assert.equal(res.status, 400);
  });

  it('does not let the user accept an open comment', async () => {
    assert.equal((await api(`/api/comments/${id}/accept`, { method: 'POST' })).status, 409);
  });

  it('lets Claude work it through MCP and pushes changes to the extension', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: ext.origin });
    const events: ServerToExtension[] = [];
    ws.on('message', (d) => events.push(JSON.parse(String(d)) as ServerToExtension));
    await new Promise((r) => ws.once('open', r));

    const client = await mcpClient();
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(tools, [
      'capture_screenshot',
      'get_comment',
      'get_screenshot',
      'list_comments',
      'reply',
      'start_work',
      'submit_solution',
    ]);

    const list = textOf(await client.callTool({ name: 'list_comments', arguments: {} }));
    assert.match(list, new RegExp(`#${id} \\[Open\\] Remove`));

    const detail = await client.callTool({ name: 'get_comment', arguments: { id } });
    assert.match(textOf(detail), /Remove it in the source code/);
    assert.match(textOf(detail), /CasePage > Toolbar/);
    assert.ok((detail.content as { type: string }[]).some((c) => c.type === 'image'));

    await client.callTool({ name: 'start_work', arguments: { id } });
    await client.callTool({ name: 'reply', arguments: { id, message: 'On it.' } });
    const submitted = await client.callTool({
      name: 'submit_solution',
      arguments: { id, note: 'Removed the save button from Toolbar.', files: ['src/features/case/Toolbar.tsx'] },
    });
    assert.ok(!submitted.isError);

    const again = await client.callTool({ name: 'start_work', arguments: { id } });
    assert.equal(again.isError, true, 'Claude cannot move it back once review ready');

    await client.close();
    await new Promise((r) => setTimeout(r, 50));
    ws.close();
    assert.ok(events.some((e) => e.type === 'comments-changed' && e.origin === 'http://localhost:5173'));

    const c = (await api<Comment>(`/api/comments/${id}`)).body;
    assert.equal(c.status, 'review_ready');
    assert.equal(c.solution?.files[0], 'src/features/case/Toolbar.tsx');
    assert.ok(c.messages.some((m) => m.author === 'claude' && m.body === 'On it.'));
  });

  it('reopen moves the old solution into the thread', async () => {
    const res = await api<Comment>(`/api/comments/${id}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Still there on mobile.' }),
    });
    assert.equal(res.body.status, 'open');
    assert.equal(res.body.solution, null);
    assert.ok(res.body.messages.some((m) => m.body.startsWith('Previous solution')));
  });

  it('accept after a new solution', async () => {
    const client = await mcpClient();
    await client.callTool({ name: 'submit_solution', arguments: { id, note: 'Also hidden on mobile now.' } });
    await client.close();
    assert.equal((await api<Comment>(`/api/comments/${id}/accept`, { method: 'POST' })).body.status, 'accepted');
  });

  it('capture_screenshot relays through the extension socket', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: ext.origin });
    ws.on('message', (d) => {
      const msg = JSON.parse(String(d)) as ServerToExtension;
      if (msg.type === 'capture-request') {
        ws.send(
          JSON.stringify({
            type: 'capture-result',
            requestId: msg.requestId,
            ok: true,
            page: tinyPng(),
            element: tinyPng(),
            note: null,
          }),
        );
      }
    });
    await new Promise((r) => ws.once('open', r));
    const client = await mcpClient();
    const res = await client.callTool({ name: 'capture_screenshot', arguments: { id } });
    assert.ok(!res.isError, textOf(res));
    assert.equal((res.content as { type: string }[]).filter((c) => c.type === 'image').length, 2);
    await client.close();
    ws.close();
    const c = (await api<Comment>(`/api/comments/${id}`)).body;
    assert.equal(c.screenshots.filter((s) => s.source === 'capture').length, 2);
  });

  it('capture_screenshot fails clearly without the extension', async () => {
    await new Promise((r) => setTimeout(r, 50));
    const client = await mcpClient();
    const res = await client.callTool({ name: 'capture_screenshot', arguments: { id } });
    assert.equal(res.isError, true);
    assert.match(textOf(res), /not connected/);
    await client.close();
  });

  it('delete removes the comment', async () => {
    assert.equal((await api(`/api/comments/${id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await api(`/api/comments/${id}`)).status, 404);
  });

  it('rejects a websocket from a website', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'http://localhost:5173' });
    const err = await new Promise<Error>((r) => ws.once('error', r));
    assert.match(err.message, /403|Unexpected server response/);
  });
});
