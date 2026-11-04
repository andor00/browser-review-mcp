// The popover to write a comment, remove an element, or edit it.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Change, Comment, Kind, TextChange } from '@brm/shared';
import { bridge } from '../bridge.ts';
import { withCapture } from '../capture.ts';
import { textNodesOf, type Previews } from '../previews.ts';
import { buildTarget, describe, probeReact, textOf } from '../targets.ts';
import { useTrackedRect } from '../hooks.ts';
import { px } from '../px.ts';

interface Props {
  el: Element | null;
  initialKind: Kind;
  previews: Previews;
  onCreated: (c: Comment) => Promise<void>;
  onCancel: () => void;
}

const WIDTH = 340;

export function Composer({ el, initialKind, previews, onCreated, onCancel }: Props) {
  const [kind, setKind] = useState<Kind>(el ? initialKind : 'comment');
  const [body, setBody] = useState('');
  const textNodes = useMemo(() => (el ? textNodesOf(el) : []), [el]);
  const originals = useMemo(() => textNodes.map((n) => n.nodeValue ?? ''), [textNodes]);
  const [texts, setTexts] = useState<string[]>(originals);
  const [css, setCss] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const textChanges = useMemo<TextChange[]>(
    () =>
      texts
        .map((after, index) => ({ index, before: originals[index] ?? '', after }))
        .filter((t) => t.before !== t.after),
    [texts, originals],
  );

  const change = useMemo<Change | null>(() => {
    if (kind === 'remove') return { kind: 'remove' };
    if (kind === 'edit') return { kind: 'edit', texts: textChanges, css };
    return null;
  }, [kind, textChanges, css]);

  // Live preview while composing.
  useEffect(() => {
    if (el && change) previews.setDraft(el, change);
    else previews.clearDraft();
  }, [el, change, previews]);
  useEffect(() => () => previews.clearDraft(), [previews]);

  useEffect(() => {
    bodyRef.current?.focus();
  }, [kind]);

  const resolve = useMemo(() => (el ? () => el : null), [el]);
  const tracked = useTrackedRect(kind === 'remove' ? null : resolve);
  // When the element is hidden (remove preview) keep the last known spot.
  const anchor = useRef(el?.getBoundingClientRect() ?? null);
  if (tracked) anchor.current = new DOMRect(tracked.x, tracked.y, tracked.width, tracked.height);

  const label = useMemo(() => {
    if (!el) return 'Whole page';
    const comp = probeReact(el).components.at(-1);
    const d = describe(el.tagName.toLowerCase(), textOf(el, 40), el.getAttribute('class') ?? '');
    return comp ? `${comp}  ${d}` : d;
  }, [el]);

  async function save() {
    if (saving) return;
    if (kind === 'comment' && !body.trim()) return setError('Write a comment first.');
    if (kind === 'edit' && textChanges.length === 0 && !css.trim()) return setError('Change a text or add some CSS first.');
    setSaving(true);
    setError(null);
    try {
      // Screenshot and target info from the original, unchanged element.
      previews.clearDraft();
      const target = el ? buildTarget(el) : null;
      const screenshots = await withCapture(el, (rect) => bridge.capture(rect));
      if (el && change) previews.setDraft(el, change);
      const created = await bridge.createComment({
        kind,
        url: location.href,
        title: document.title,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        target,
        change,
        body,
        screenshots,
      });
      await onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void save();
    }
  }

  // Place below the element, or above when there is no room, inside the viewport.
  const style = useMemo(() => {
    const r = anchor.current;
    if (!r) return px({ right: 16, bottom: 72, width: WIDTH });
    const left = Math.max(8, Math.min(innerWidth - WIDTH - 8, r.left));
    const below = r.bottom + 10;
    if (below + 260 < innerHeight) return px({ left, top: below, width: WIDTH });
    const above = r.top - 10;
    if (above > 260) return px({ left, bottom: innerHeight - above, width: WIDTH });
    return px({ left, top: Math.max(8, innerHeight / 2 - 150), width: WIDTH });
  }, [tracked?.x, tracked?.y, tracked?.width, tracked?.height]);

  return (
    <>
      {tracked && kind !== 'remove' && (
        <div class="brm-selected" style={px({ left: tracked.x, top: tracked.y, width: tracked.width, height: tracked.height })} />
      )}
      <div class={`brm-ui brm-card brm-composer ${el ? '' : 'is-page'}`} style={style} onKeyDown={onKeyDown}>
        <div class="brm-composer-head">
          <span class="brm-target-label" title={label}>
            {label}
          </span>
          <button class="brm-icon-btn" title="Cancel (Esc)" onClick={onCancel}>
            ✕
          </button>
        </div>
        {el && (
          <div class="brm-tabs" role="tablist">
            {(['comment', 'remove', 'edit'] as const).map((k) => (
              <button
                key={k}
                role="tab"
                class={`brm-tab ${kind === k ? 'is-active' : ''}`}
                aria-selected={kind === k}
                onClick={() => {
                  setKind(k);
                  setError(null);
                }}
              >
                {k === 'comment' ? 'Comment' : k === 'remove' ? 'Remove' : 'Edit'}
              </button>
            ))}
          </div>
        )}

        {kind === 'remove' && (
          <p class="brm-help">The element is hidden now. Claude removes it in the code. You can undo this in the sidebar.</p>
        )}

        {kind === 'edit' && (
          <div class="brm-edit">
            {textNodes.length === 0 && <p class="brm-help">This element has no text. You can still add CSS.</p>}
            {texts.map((t, i) => (
              <label key={i} class="brm-field">
                <span class="brm-field-label">Text {texts.length > 1 ? i + 1 : ''}</span>
                <textarea
                  rows={Math.min(4, Math.max(1, Math.ceil(t.length / 40)))}
                  value={t}
                  onInput={(e) => {
                    const v = (e.target as HTMLTextAreaElement).value;
                    setTexts((prev) => prev.map((p, j) => (j === i ? v : p)));
                  }}
                />
              </label>
            ))}
            <label class="brm-field">
              <span class="brm-field-label">CSS</span>
              <textarea
                rows={2}
                class="brm-mono"
                placeholder="color: #333; font-size: 14px; margin-top: 8px"
                value={css}
                onInput={(e) => setCss((e.target as HTMLTextAreaElement).value)}
              />
            </label>
          </div>
        )}

        <label class="brm-field">
          <span class="brm-field-label">
            {kind === 'comment' ? 'Comment' : kind === 'remove' ? 'Why? (optional)' : 'Note (optional)'}
          </span>
          <textarea
            ref={bodyRef}
            rows={3}
            value={body}
            placeholder={kind === 'comment' ? (el ? 'What should change here?' : 'What should change on this page?') : ''}
            onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
          />
        </label>

        {error && <p class="brm-error">{error}</p>}

        <div class="brm-actions">
          <span class="brm-dim">Ctrl+Enter</span>
          <button class="brm-btn" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button class="brm-btn brm-primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving' : kind === 'comment' ? 'Add comment' : kind === 'remove' ? 'Remove element' : 'Save edit'}
          </button>
        </div>
      </div>
    </>
  );
}
