import type { IncomingMessage, ServerResponse } from 'node:http';
import * as z from 'zod';
import { KINDS, STATUSES, type CreateCommentInput, type Status } from '@brm/shared';
import { StoreError, type Store } from './store.ts';
import type { Hub } from './hub.ts';

const MAX_BODY = 40 * 1024 * 1024; // screenshots are big

const rect = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });

const target = z.object({
  selectors: z.array(z.string().max(2000)).min(1).max(20),
  tag: z.string().max(100),
  text: z.string().max(5000),
  html: z.string().max(20000),
  rect,
  components: z.array(z.string().max(200)).max(50),
  source: z.string().max(1000).nullable(),
});

const change = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('remove') }),
  z.object({
    kind: z.literal('edit'),
    texts: z
      .array(z.object({ index: z.number().int().min(0), before: z.string(), after: z.string() }))
      .max(200),
    css: z.string().max(10000),
  }),
]);

const createInput = z.object({
  kind: z.enum(KINDS),
  url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u), 'Only localhost pages.'),
  title: z.string().max(500),
  viewport: z.object({ width: z.number(), height: z.number(), dpr: z.number() }),
  target: target.nullable(),
  change: change.nullable(),
  body: z.string().max(20000),
  screenshots: z.object({ page: z.string().optional(), element: z.string().optional() }).optional(),
});

const messageInput = z.object({ body: z.string().min(1).max(20000) });
const reopenInput = z.object({ body: z.string().max(20000).optional() });

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request body too large.');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Body is not valid JSON.');
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const res = schema.safeParse(value);
  if (!res.success) throw new HttpError(400, z.prettifyError(res.error));
  return res.data;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(data);
}

/** Handles /api/*. Returns false when the path is not an API route. */
export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  store: Store,
  hub: Hub,
  version: string,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/')) return false;
  const method = req.method ?? 'GET';
  const parts = url.pathname.split('/').filter(Boolean); // ["api", "comments", "12", "accept"]

  try {
    if (parts[1] === 'health' && method === 'GET') {
      sendJson(res, 200, { ok: true, version, extensionsConnected: hub.connected });
      return true;
    }

    if (parts[1] === 'screenshots' && parts.length === 3 && method === 'GET') {
      const shot = store.readScreenshot(Number(parts[2]));
      if (!shot) throw new HttpError(404, 'Screenshot not found.');
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'private, max-age=31536000, immutable' });
      res.end(shot.png);
      return true;
    }

    if (parts[1] === 'comments') {
      // /api/comments
      if (parts.length === 2) {
        if (method === 'GET') {
          const statuses = (url.searchParams.get('status') ?? '')
            .split(',')
            .filter((s): s is Status => (STATUSES as readonly string[]).includes(s));
          const comments = store.list({
            origin: url.searchParams.get('origin') ?? undefined,
            path: url.searchParams.get('path') ?? undefined,
            statuses,
          });
          sendJson(res, 200, comments);
          return true;
        }
        if (method === 'POST') {
          const input = parse(createInput, await readJson(req)) as CreateCommentInput;
          const comment = store.create(input);
          hub.commentsChanged(comment.origin);
          sendJson(res, 201, comment);
          return true;
        }
      }

      const id = Number(parts[2]);
      if (!Number.isInteger(id)) throw new HttpError(404, 'Not found.');

      // /api/comments/:id
      if (parts.length === 3) {
        if (method === 'GET') {
          sendJson(res, 200, store.mustGet(id));
          return true;
        }
        if (method === 'DELETE') {
          const { origin } = store.mustGet(id);
          store.delete(id);
          hub.commentsChanged(origin);
          sendJson(res, 200, { ok: true });
          return true;
        }
      }

      // /api/comments/:id/<action>
      if (parts.length === 4 && method === 'POST') {
        const action = parts[3];
        let comment;
        if (action === 'messages') {
          comment = store.addMessage(id, 'user', parse(messageInput, await readJson(req)).body);
        } else if (action === 'accept') {
          comment = store.accept(id);
        } else if (action === 'reopen') {
          comment = store.reopen(id, parse(reopenInput, await readJson(req)).body);
        } else {
          throw new HttpError(404, 'Not found.');
        }
        hub.commentsChanged(comment.origin);
        sendJson(res, 200, comment);
        return true;
      }
    }

    throw new HttpError(404, 'Not found.');
  } catch (err) {
    if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
    else if (err instanceof StoreError) {
      const status = err.code === 'not_found' ? 404 : err.code === 'invalid_transition' ? 409 : 400;
      sendJson(res, status, { error: err.message });
    } else {
      console.error(err);
      sendJson(res, 500, { error: 'Internal error.' });
    }
    return true;
  }
}
