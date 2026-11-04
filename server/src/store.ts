import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  pageKey,
  type Author,
  type Change,
  type Comment,
  type CreateCommentInput,
  type Message,
  type ScreenshotKind,
  type ScreenshotMeta,
  type ScreenshotSource,
  type Solution,
  type Status,
  type TargetInfo,
  type Viewport,
} from '@brm/shared';

export type StoreErrorCode = 'not_found' | 'invalid_transition' | 'bad_input';

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'StoreError';
  }
}

export interface ListFilter {
  origin?: string;
  path?: string;
  statuses?: Status[];
}

interface CommentRow {
  id: number;
  kind: string;
  status: string;
  origin: string;
  path: string;
  url: string;
  title: string;
  viewport: string;
  target: string | null;
  change: string | null;
  solution: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: number;
  comment_id: number;
  author: string;
  body: string;
  created_at: string;
}

interface ScreenshotRow {
  id: number;
  comment_id: number;
  kind: string;
  source: string;
  file: string;
  created_at: string;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decodes a "data:image/png;base64,..." string and checks it really is a PNG. */
export function decodePngDataUrl(dataUrl: string): Buffer {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match?.[1]) throw new StoreError('bad_input', 'Screenshot must be a PNG data URL.');
  const buf = Buffer.from(match[1], 'base64');
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new StoreError('bad_input', 'Screenshot is not a valid PNG.');
  }
  return buf;
}

function now(): string {
  return new Date().toISOString();
}

export class Store {
  readonly #db: DatabaseSync;
  readonly #shotDir: string;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.#shotDir = join(dataDir, 'screenshots');
    mkdirSync(this.#shotDir, { recursive: true });
    this.#db = new DatabaseSync(join(dataDir, 'review.sqlite'));
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        origin TEXT NOT NULL,
        path TEXT NOT NULL,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        viewport TEXT NOT NULL,
        target TEXT,
        change TEXT,
        solution TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS comments_page ON comments(origin, path);
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
        author TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_comment ON messages(comment_id);
      CREATE TABLE IF NOT EXISTS screenshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        source TEXT NOT NULL,
        file TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS screenshots_comment ON screenshots(comment_id);
    `);
  }

  close(): void {
    this.#db.close();
  }

  // ---------- reading ----------

  get(id: number): Comment | null {
    const row = this.#db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as CommentRow | undefined;
    if (!row) return null;
    return this.#hydrate([row])[0] ?? null;
  }

  mustGet(id: number): Comment {
    const c = this.get(id);
    if (!c) throw new StoreError('not_found', `Comment #${id} does not exist.`);
    return c;
  }

  list(filter: ListFilter = {}): Comment[] {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.origin) {
      where.push('origin = ?');
      params.push(filter.origin);
    }
    if (filter.path) {
      where.push('path = ?');
      params.push(filter.path);
    }
    if (filter.statuses?.length) {
      where.push(`status IN (${filter.statuses.map(() => '?').join(', ')})`);
      params.push(...filter.statuses);
    }
    const sql = `SELECT * FROM comments ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id`;
    const rows = this.#db.prepare(sql).all(...params) as unknown as CommentRow[];
    return this.#hydrate(rows);
  }

  #hydrate(rows: CommentRow[]): Comment[] {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const marks = ids.map(() => '?').join(', ');
    const messages = this.#db
      .prepare(`SELECT * FROM messages WHERE comment_id IN (${marks}) ORDER BY id`)
      .all(...ids) as unknown as MessageRow[];
    const shots = this.#db
      .prepare(`SELECT * FROM screenshots WHERE comment_id IN (${marks}) ORDER BY id`)
      .all(...ids) as unknown as ScreenshotRow[];

    const msgBy = new Map<number, Message[]>();
    for (const m of messages) {
      const list = msgBy.get(m.comment_id) ?? [];
      list.push({ id: m.id, author: m.author as Author, body: m.body, createdAt: m.created_at });
      msgBy.set(m.comment_id, list);
    }
    const shotBy = new Map<number, ScreenshotMeta[]>();
    for (const s of shots) {
      const list = shotBy.get(s.comment_id) ?? [];
      list.push({
        id: s.id,
        kind: s.kind as ScreenshotKind,
        source: s.source as ScreenshotSource,
        createdAt: s.created_at,
      });
      shotBy.set(s.comment_id, list);
    }

    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as Comment['kind'],
      status: r.status as Status,
      origin: r.origin,
      path: r.path,
      url: r.url,
      title: r.title,
      viewport: JSON.parse(r.viewport) as Viewport,
      target: r.target ? (JSON.parse(r.target) as TargetInfo) : null,
      change: r.change ? (JSON.parse(r.change) as Change) : null,
      solution: r.solution ? (JSON.parse(r.solution) as Solution) : null,
      messages: msgBy.get(r.id) ?? [],
      screenshots: shotBy.get(r.id) ?? [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  // ---------- writing ----------

  create(input: CreateCommentInput): Comment {
    const { origin, path } = pageKey(input.url);
    if (input.kind === 'comment' && !input.body.trim()) {
      throw new StoreError('bad_input', 'A comment needs some text.');
    }
    if (input.kind !== 'comment' && input.change?.kind !== input.kind) {
      throw new StoreError('bad_input', `A ${input.kind} needs a matching change.`);
    }
    if (input.kind !== 'comment' && !input.target) {
      throw new StoreError('bad_input', `A ${input.kind} needs a target element.`);
    }
    // Decode screenshots before writing anything, so bad input leaves no half comment.
    const page = input.screenshots?.page ? decodePngDataUrl(input.screenshots.page) : null;
    const element = input.screenshots?.element ? decodePngDataUrl(input.screenshots.element) : null;

    const t = now();
    const id = this.#tx(() => {
      const res = this.#db
        .prepare(
          `INSERT INTO comments (kind, status, origin, path, url, title, viewport, target, change, solution, created_at, updated_at)
           VALUES (?, 'open', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .run(
          input.kind,
          origin,
          path,
          input.url,
          input.title,
          JSON.stringify(input.viewport),
          input.target ? JSON.stringify(input.target) : null,
          input.change ? JSON.stringify(input.change) : null,
          t,
          t,
        );
      const newId = Number(res.lastInsertRowid);
      const body = input.body.trim() || defaultBody(input);
      this.#insertMessage(newId, 'user', body, t);
      return newId;
    });
    if (page) this.addScreenshot(id, 'page', 'initial', page);
    if (element) this.addScreenshot(id, 'element', 'initial', element);
    return this.mustGet(id);
  }

  addMessage(id: number, author: Author, body: string): Comment {
    if (!body.trim()) throw new StoreError('bad_input', 'Message is empty.');
    this.mustGet(id);
    this.#tx(() => {
      this.#insertMessage(id, author, body.trim(), now());
      this.#touch(id);
    });
    return this.mustGet(id);
  }

  /** Claude: open or in progress -> in progress. */
  startWork(id: number): Comment {
    const c = this.mustGet(id);
    if (c.status === 'in_progress') return c;
    if (c.status !== 'open') {
      throw new StoreError(
        'invalid_transition',
        `Comment #${id} is ${c.status}. Only open comments can be started. ` +
          (c.status === 'review_ready' ? 'It is waiting for the user to review.' : 'It is already accepted.'),
      );
    }
    this.#setStatus(id, 'in_progress', 'Claude started working on this.');
    return this.mustGet(id);
  }

  /** Claude: open or in progress -> review ready, with a note on how it was solved. */
  submitSolution(id: number, note: string, files: string[] = []): Comment {
    const c = this.mustGet(id);
    if (!note.trim()) throw new StoreError('bad_input', 'The solution note is empty.');
    if (c.status !== 'open' && c.status !== 'in_progress') {
      throw new StoreError(
        'invalid_transition',
        `Comment #${id} is ${c.status}. A solution can only be submitted for open or in progress comments.`,
      );
    }
    const solution: Solution = {
      note: note.trim(),
      files: files.map((f) => f.trim()).filter(Boolean),
      createdAt: now(),
    };
    this.#tx(() => {
      this.#db.prepare('UPDATE comments SET solution = ? WHERE id = ?').run(JSON.stringify(solution), id);
      this.#setStatusRaw(id, 'review_ready', 'Claude marked this review ready.');
    });
    return this.mustGet(id);
  }

  /** User: review ready -> accepted. */
  accept(id: number): Comment {
    const c = this.mustGet(id);
    if (c.status !== 'review_ready') {
      throw new StoreError('invalid_transition', `Comment #${id} is ${c.status}, not review ready.`);
    }
    this.#setStatus(id, 'accepted', 'Solution accepted.');
    return this.mustGet(id);
  }

  /** User: review ready or accepted -> open. The old solution moves into the thread. */
  reopen(id: number, body?: string): Comment {
    const c = this.mustGet(id);
    if (c.status !== 'review_ready' && c.status !== 'accepted') {
      throw new StoreError('invalid_transition', `Comment #${id} is ${c.status}, it is already open.`);
    }
    this.#tx(() => {
      const t = now();
      if (c.solution) {
        const files = c.solution.files.length ? `\nFiles: ${c.solution.files.join(', ')}` : '';
        this.#insertMessage(id, 'system', `Previous solution (not accepted):\n${c.solution.note}${files}`, t);
      }
      if (body?.trim()) this.#insertMessage(id, 'user', body.trim(), t);
      this.#db.prepare('UPDATE comments SET solution = NULL WHERE id = ?').run(id);
      this.#setStatusRaw(id, 'open', 'Reopened.');
    });
    return this.mustGet(id);
  }

  delete(id: number): void {
    this.mustGet(id);
    const files = this.#db.prepare('SELECT file FROM screenshots WHERE comment_id = ?').all(id) as unknown as {
      file: string;
    }[];
    this.#db.prepare('DELETE FROM comments WHERE id = ?').run(id);
    for (const f of files) rmSync(join(this.#shotDir, f.file), { force: true });
  }

  // ---------- screenshots ----------

  addScreenshot(id: number, kind: ScreenshotKind, source: ScreenshotSource, png: Buffer): ScreenshotMeta {
    const file = `${id}-${kind}-${randomUUID()}.png`;
    writeFileSync(join(this.#shotDir, file), png);
    const t = now();
    const res = this.#db
      .prepare('INSERT INTO screenshots (comment_id, kind, source, file, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, kind, source, file, t);
    return { id: Number(res.lastInsertRowid), kind, source, createdAt: t };
  }

  readScreenshot(shotId: number): { commentId: number; meta: ScreenshotMeta; png: Buffer } | null {
    const row = this.#db.prepare('SELECT * FROM screenshots WHERE id = ?').get(shotId) as ScreenshotRow | undefined;
    if (!row) return null;
    try {
      const png = readFileSync(join(this.#shotDir, row.file));
      return {
        commentId: row.comment_id,
        meta: {
          id: row.id,
          kind: row.kind as ScreenshotKind,
          source: row.source as ScreenshotSource,
          createdAt: row.created_at,
        },
        png,
      };
    } catch {
      return null;
    }
  }

  /** Newest screenshot of a kind, optionally only from one source. */
  latestScreenshot(id: number, kind: ScreenshotKind, source?: ScreenshotSource): ScreenshotMeta | null {
    const c = this.mustGet(id);
    const list = c.screenshots.filter((s) => s.kind === kind && (!source || s.source === source));
    return list.at(-1) ?? null;
  }

  // ---------- internals ----------

  #insertMessage(id: number, author: Author, body: string, t: string): void {
    this.#db
      .prepare('INSERT INTO messages (comment_id, author, body, created_at) VALUES (?, ?, ?, ?)')
      .run(id, author, body, t);
  }

  #touch(id: number): void {
    this.#db.prepare('UPDATE comments SET updated_at = ? WHERE id = ?').run(now(), id);
  }

  #setStatus(id: number, status: Status, note: string): void {
    this.#tx(() => this.#setStatusRaw(id, status, note));
  }

  #setStatusRaw(id: number, status: Status, note: string): void {
    const t = now();
    this.#db.prepare('UPDATE comments SET status = ?, updated_at = ? WHERE id = ?').run(status, t, id);
    this.#insertMessage(id, 'system', note, t);
  }

  #depth = 0;
  #tx<T>(fn: () => T): T {
    if (this.#depth > 0) return fn();
    this.#db.exec('BEGIN');
    this.#depth++;
    try {
      const result = fn();
      this.#db.exec('COMMIT');
      return result;
    } catch (err) {
      this.#db.exec('ROLLBACK');
      throw err;
    } finally {
      this.#depth--;
    }
  }
}

function defaultBody(input: CreateCommentInput): string {
  if (input.kind === 'remove') return 'Remove this element.';
  if (input.kind === 'edit') return 'Apply this edit.';
  return '';
}
