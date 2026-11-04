import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { STATUSES, STATUS_LABELS, type Comment, type ScreenshotKind } from '@brm/shared';
import { decodePngDataUrl, StoreError, type Store } from './store.ts';
import type { Hub } from './hub.ts';
import { formatComment, formatListLine } from './format.ts';

type Content =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: 'image/png' };

interface ToolResult {
  content: Content[];
  isError?: boolean;
  [key: string]: unknown;
}

function text(t: string): ToolResult {
  return { content: [{ type: 'text', text: t }] };
}

function image(png: Buffer): Content {
  return { type: 'image', data: png.toString('base64'), mimeType: 'image/png' };
}

/** Turns store errors into readable tool errors instead of protocol errors. */
async function guarded(fn: () => ToolResult | Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof StoreError || err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: msg }], isError: true };
  }
}

const idSchema = z.number().int().positive().describe('Comment id, the number after # (for example 12).');

const INSTRUCTIONS = `Review comments the user left on their localhost dev app with the Browser Review extension.
Each comment is a general page comment or pinned to one element, and is either a plain comment, a request to remove the element, or a request to edit it (text and CSS).
Workflow: list_comments, then for each one get_comment, start_work, fix it in the source code, optionally capture_screenshot to check, then submit_solution with a short note on how you solved it.
You can only set "in progress" and "review ready". The user accepts or reopens in the browser. Use reply to ask the user a question in the thread.`;

export function buildMcpServer(store: Store, hub: Hub, version: string): McpServer {
  const server = new McpServer({ name: 'browser-review', version }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'list_comments',
    {
      description:
        'List review comments. By default only the ones that need work (open and in progress). Returns one line per comment.',
      inputSchema: z.object({
        status: z
          .array(z.enum(STATUSES))
          .optional()
          .describe('Statuses to include. Default ["open", "in_progress"].'),
        origin: z.string().optional().describe('Only this site, for example "http://localhost:5173".'),
      }),
    },
    ({ status, origin }) =>
      guarded(() => {
        const statuses = status?.length ? status : (['open', 'in_progress'] as const);
        const list = store.list({ origin, statuses: [...statuses] });
        const labels = statuses.map((s) => STATUS_LABELS[s].toLowerCase()).join(', ');
        if (list.length === 0) return text(`No comments with status ${labels}.`);
        return text(
          `${list.length} comment(s) with status ${labels}:\n${list.map(formatListLine).join('\n')}\n\nUse get_comment for the details.`,
        );
      }),
  );

  server.registerTool(
    'get_comment',
    {
      description:
        'Get everything about one comment: page, element (selectors, text, HTML, React components, source file), the requested change, the thread and any solution. Attaches the element screenshot (or page screenshot for page comments) unless with_screenshot is false.',
      inputSchema: z.object({
        id: idSchema,
        with_screenshot: z.boolean().optional().describe('Attach the stored screenshot. Default true.'),
      }),
    },
    ({ id, with_screenshot }) =>
      guarded(() => {
        const c = store.mustGet(id);
        const result = text(formatComment(c));
        if (with_screenshot !== false) {
          const meta = store.latestScreenshot(id, c.target ? 'element' : 'page', 'initial');
          const shot = meta ? store.readScreenshot(meta.id) : null;
          if (shot) result.content.push(image(shot.png));
        }
        return result;
      }),
  );

  server.registerTool(
    'get_screenshot',
    {
      description:
        'Get a stored screenshot of a comment. "page" is the visible part of the page with the element outlined, "element" is a crop of the element. By default the newest one, which may be a later capture.',
      inputSchema: z.object({
        id: idSchema,
        kind: z.enum(['page', 'element']).optional().describe('Default "page".'),
        which: z
          .enum(['latest', 'initial'])
          .optional()
          .describe('"initial" is the one taken when the comment was made. Default "latest".'),
      }),
    },
    ({ id, kind, which }) =>
      guarded(() => {
        const k: ScreenshotKind = kind ?? 'page';
        const meta = store.latestScreenshot(id, k, which === 'initial' ? 'initial' : undefined);
        if (!meta) return { ...text(`Comment #${id} has no ${k} screenshot.`), isError: true };
        const shot = store.readScreenshot(meta.id);
        if (!shot) return { ...text('The screenshot file is missing.'), isError: true };
        const when = meta.source === 'initial' ? 'taken when the comment was made' : 'captured later';
        return { content: [{ type: 'text', text: `${k} screenshot, ${when} (${meta.createdAt}).` }, image(shot.png)] };
      }),
  );

  server.registerTool(
    'capture_screenshot',
    {
      description:
        'Take a fresh screenshot now, to check your fix. The extension switches to an open browser tab on that page, scrolls the element into view and captures it. Needs Brave open with the page loaded. The dev server should have reloaded your change first.',
      inputSchema: z.object({ id: idSchema }),
    },
    ({ id }) =>
      guarded(async () => {
        const c = store.mustGet(id);
        const result = await hub.requestCapture(c);
        const page = decodePngDataUrl(result.page);
        store.addScreenshot(id, 'page', 'capture', page);
        const content: Content[] = [];
        const notes = [result.note].filter(Boolean).join(' ');
        content.push({ type: 'text', text: `Fresh page screenshot of ${c.url}.${notes ? ` ${notes}` : ''}` });
        content.push(image(page));
        if (result.element) {
          const el = decodePngDataUrl(result.element);
          store.addScreenshot(id, 'element', 'capture', el);
          content.push({ type: 'text', text: 'Crop of the element:' }, image(el));
        }
        return { content };
      }),
  );

  server.registerTool(
    'start_work',
    {
      description: 'Mark a comment as in progress. Call this before you start fixing it, so the user sees it.',
      inputSchema: z.object({ id: idSchema }),
    },
    ({ id }) =>
      guarded(() => {
        const c = store.startWork(id);
        hub.commentsChanged(c.origin);
        return text(`#${c.id} is now ${STATUS_LABELS[c.status].toLowerCase()}.`);
      }),
  );

  server.registerTool(
    'reply',
    {
      description:
        'Write a message in the comment thread, for example a question for the user or an update. Does not change the status.',
      inputSchema: z.object({ id: idSchema, message: z.string().min(1).max(20000) }),
    },
    ({ id, message }) =>
      guarded(() => {
        const c = store.addMessage(id, 'claude', message);
        hub.commentsChanged(c.origin);
        return text(`Reply added to #${c.id}.`);
      }),
  );

  server.registerTool(
    'submit_solution',
    {
      description:
        'Mark a comment as review ready with a short note on how you solved it: what was wrong, what you changed. The user then accepts or reopens it in the browser. For removals and edits the browser preview turns off, so the user sees your real change.',
      inputSchema: z.object({
        id: idSchema,
        note: z.string().min(1).max(5000).describe('Short explanation for the user, a few sentences, plain language.'),
        files: z.array(z.string()).optional().describe('Files you changed, relative to the project root.'),
      }),
    },
    ({ id, note, files }) =>
      guarded(() => {
        const c: Comment = store.submitSolution(id, note, files);
        hub.commentsChanged(c.origin);
        return text(`#${c.id} is now review ready. The user will accept or reopen it.`);
      }),
  );

  return server;
}

export function createMcp(store: Store, hub: Hub, version: string) {
  return createMcpHandler(() => buildMcpServer(store, hub, version));
}
