import { useEffect, useRef, useState } from 'preact/hooks';
import { KIND_LABELS, STATUS_LABELS, type Comment, type Status } from '@brm/shared';
import { bridge } from '../bridge.ts';
import { describe } from '../targets.ts';
import { expandedDraft, replyDraft } from '../drafts.ts';

export type Filter = 'active' | 'review_ready' | 'accepted' | 'all';
export type Scope = 'page' | 'site';

const FILTERS: { key: Filter; label: string; statuses: Status[] }[] = [
  { key: 'active', label: 'Active', statuses: ['open', 'in_progress', 'review_ready'] },
  { key: 'review_ready', label: 'Review ready', statuses: ['review_ready'] },
  { key: 'accepted', label: 'Accepted', statuses: ['accepted'] },
  { key: 'all', label: 'All', statuses: ['open', 'in_progress', 'review_ready', 'accepted'] },
];

interface Props {
  comments: Comment[];
  path: string;
  connected: boolean;
  focusId: number | null;
  onClose: () => void;
  onHover: (id: number | null) => void;
  onGoTo: (c: Comment) => string | null;
  onChanged: () => Promise<void>;
}

function time(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const ORDER: Record<Status, number> = { review_ready: 0, in_progress: 1, open: 2, accepted: 3 };

export function Sidebar({ comments, path, connected, focusId, onClose, onHover, onGoTo, onChanged }: Props) {
  const [scope, setScope] = useState<Scope>('page');
  const [filter, setFilter] = useState<Filter>('active');
  const [expanded, setExpanded] = useState<number | null>(() => focusId ?? expandedDraft.get());

  useEffect(() => expandedDraft.set(expanded), [expanded]);

  useEffect(() => {
    if (focusId === null) return;
    const c = comments.find((x) => x.id === focusId);
    setExpanded(focusId);
    if (c && c.path !== path) setScope('site');
    if (c && !FILTERS.find((f) => f.key === filter)?.statuses.includes(c.status)) setFilter('all');
  }, [focusId]);

  const inScope = comments.filter((c) => scope === 'site' || c.path === path);
  const statuses = FILTERS.find((f) => f.key === filter)?.statuses ?? [];
  const shown = inScope
    .filter((c) => statuses.includes(c.status))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.updatedAt.localeCompare(a.updatedAt));

  return (
    <aside class="brm-ui brm-sidebar" aria-label="Review threads">
      <header class="brm-side-head">
        <strong>Review</strong>
        <div class="brm-seg">
          <button class={scope === 'page' ? 'is-active' : ''} onClick={() => setScope('page')}>
            This page
          </button>
          <button class={scope === 'site' ? 'is-active' : ''} onClick={() => setScope('site')}>
            Whole site
          </button>
        </div>
        <button class="brm-icon-btn" title="Close (Alt+Shift+T)" onClick={onClose}>
          ✕
        </button>
      </header>
      <nav class="brm-filters">
        {FILTERS.map((f) => {
          const n = inScope.filter((c) => f.statuses.includes(c.status)).length;
          return (
            <button key={f.key} class={`brm-chip ${filter === f.key ? 'is-active' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label} <span class="brm-dim">{n}</span>
            </button>
          );
        })}
      </nav>
      {!connected && (
        <p class="brm-warn">
          The review server is not running. Start it in the project folder with <code>pnpm server</code>. Showing the
          last known state.
        </p>
      )}
      <div class="brm-side-list">
        {shown.length === 0 && <p class="brm-empty">Nothing here.</p>}
        {shown.map((c) => (
          <Card
            key={c.id}
            comment={c}
            showPath={scope === 'site'}
            onThisPage={c.path === path}
            open={expanded === c.id}
            onToggle={() => setExpanded(expanded === c.id ? null : c.id)}
            onHover={onHover}
            onGoTo={onGoTo}
            onChanged={onChanged}
          />
        ))}
      </div>
    </aside>
  );
}

interface CardProps {
  comment: Comment;
  showPath: boolean;
  onThisPage: boolean;
  open: boolean;
  onToggle: () => void;
  onHover: (id: number | null) => void;
  onGoTo: (c: Comment) => string | null;
  onChanged: () => Promise<void>;
}

function Card({ comment: c, showPath, onThisPage, open, onToggle, onHover, onGoTo, onChanged }: CardProps) {
  const [reply, setReply] = useState(() => replyDraft.get(c.id));

  useEffect(() => replyDraft.set(c.id, reply), [c.id, reply]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  const first = c.messages.find((m) => m.author === 'user');

  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setReply('');
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const canUndo = c.kind !== 'comment' && (c.status === 'open' || c.status === 'in_progress');

  return (
    <article
      ref={ref}
      class={`brm-thread ${open ? 'is-open' : ''}`}
      onMouseEnter={() => onHover(c.id)}
      onMouseLeave={() => onHover(null)}
    >
      <button class="brm-thread-head" onClick={onToggle} aria-expanded={open}>
        <span class="brm-id">#{c.id}</span>
        <span class={`brm-badge st-${c.status}`}>{STATUS_LABELS[c.status]}</span>
        {c.kind !== 'comment' && <span class="brm-badge brm-kind">{KIND_LABELS[c.kind]}</span>}
        <span class="brm-dim brm-when">{time(c.updatedAt)}</span>
      </button>
      <div class="brm-thread-summary" onClick={onToggle}>
        <div class="brm-where">
          {c.target ? describe(c.target.tag, c.target.text) : 'Whole page'}
          {showPath && <span class="brm-dim"> on {c.path}</span>}
        </div>
        {!open && first && <div class="brm-clamp">{first.body}</div>}
      </div>

      {open && (
        <div class="brm-thread-body">
          <Thumb comment={c} />
          {c.change?.kind === 'edit' && (
            <div class="brm-change">
              {c.change.texts.map((t) => (
                <div key={t.index}>
                  <s>{t.before}</s> <span class="brm-dim">to</span> {t.after}
                </div>
              ))}
              {c.change.css.trim() && <code class="brm-mono">{c.change.css}</code>}
            </div>
          )}
          <ul class="brm-messages">
            {c.messages.map((m) => (
              <li key={m.id} class={`brm-msg by-${m.author}`}>
                {m.author !== 'system' && (
                  <div class="brm-msg-meta">
                    {m.author === 'user' ? 'You' : 'Claude'} <span class="brm-dim">{time(m.createdAt)}</span>
                  </div>
                )}
                <div class="brm-msg-body">{m.body}</div>
              </li>
            ))}
          </ul>

          {c.solution && (
            <div class="brm-solution">
              <div class="brm-solution-title">How Claude solved it</div>
              <div class="brm-msg-body">{c.solution.note}</div>
              {c.solution.files.length > 0 && (
                <ul class="brm-files">
                  {c.solution.files.map((f) => (
                    <li key={f}>
                      <code>{f}</code>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <textarea
            class="brm-reply"
            rows={2}
            placeholder={c.status === 'review_ready' ? 'Not right? Say what is still wrong and reopen.' : 'Reply'}
            value={reply}
            onInput={(e) => setReply((e.target as HTMLTextAreaElement).value)}
          />
          {error && <p class="brm-error">{error}</p>}
          {note && <p class="brm-note">{note}</p>}
          <div class="brm-actions brm-wrap">
            <button
              class="brm-btn"
              onClick={() => setNote(onGoTo(c))}
              title={
                onThisPage
                  ? c.target
                    ? 'Scroll to the element'
                    : 'Scroll to the top of the page'
                  : 'Go to the page and show the element'
              }
            >
              Go to
            </button>
            <a class="brm-btn" href={c.url} title={c.url}>
              Open page
            </a>
            {canUndo && (
              <button
                class="brm-btn"
                disabled={busy}
                onClick={() => void run(() => bridge.remove(c.id))}
                title="Bring the element back and drop this task"
              >
                Undo {c.kind === 'remove' ? 'removal' : 'edit'}
              </button>
            )}
            {c.kind === 'comment' && c.status !== 'in_progress' && (
              <button
                class="brm-btn"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Delete comment #${c.id}?`)) void run(() => bridge.remove(c.id));
                }}
              >
                Delete
              </button>
            )}
            <span class="brm-spacer" />
            {(c.status === 'review_ready' || c.status === 'accepted') && (
              <button class="brm-btn" disabled={busy} onClick={() => void run(() => bridge.reopen(c.id, reply))}>
                Reopen
              </button>
            )}
            {c.status !== 'review_ready' && c.status !== 'accepted' && (
              <button
                class="brm-btn"
                disabled={busy || !reply.trim()}
                onClick={() => void run(() => bridge.reply(c.id, reply))}
              >
                Send
              </button>
            )}
            {c.status === 'review_ready' && (
              <button class="brm-btn brm-primary" disabled={busy} onClick={() => void run(() => bridge.accept(c.id))}>
                Accept solution
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function Thumb({ comment }: { comment: Comment }) {
  const shot =
    comment.screenshots.find((s) => s.kind === 'element' && s.source === 'initial') ??
    comment.screenshots.find((s) => s.kind === 'page' && s.source === 'initial');
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!shot) return;
    let live = true;
    void bridge.screenshot(shot.id).then((d) => live && setSrc(d));
    return () => {
      live = false;
    };
  }, [shot?.id]);
  if (!shot || !src) return null;
  return (
    <a
      class="brm-thumb"
      href={src}
      onClick={(e) => {
        e.preventDefault();
        const w = window.open();
        if (w) w.document.body.innerHTML = `<img src="${src}" style="max-width:100%">`;
      }}
      title="Screenshot when the comment was made"
    >
      <img src={src} alt="Screenshot of the element" />
    </a>
  );
}
