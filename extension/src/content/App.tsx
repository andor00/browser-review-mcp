import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { isPreviewActive, pageKey, type Comment, type Kind } from '@brm/shared';
import type { PrepareCaptureResponse, TabRequest } from '../messages.ts';
import { bridge } from './bridge.ts';
import { enterCapture, nextFrames } from './capture.ts';
import { useHref } from './hooks.ts';
import type { Previews } from './previews.ts';
import { findTarget } from './targets.ts';
import { Composer } from './ui/Composer.tsx';
import { Picker } from './ui/Picker.tsx';
import { Outline, Pins } from './ui/Pins.tsx';
import { Sidebar } from './ui/Sidebar.tsx';
import { Toolbar } from './ui/Toolbar.tsx';

type Mode = { type: 'idle' } | { type: 'picking' } | { type: 'compose'; el: Element | null; kind: Kind };

const hiddenKey = (origin: string) => `hidden:${origin}`;

export function App({ previews }: { previews: Previews }) {
  const href = useHref();
  const { origin, path } = pageKey(href);
  const [comments, setComments] = useState<Comment[]>([]);
  const [connected, setConnected] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [mode, setMode] = useState<Mode>({ type: 'idle' });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [flashId, setFlashId] = useState<number | null>(null);

  // ---------- data ----------

  const load = useCallback(async () => {
    try {
      const { data, offline } = await bridge.listComments(origin);
      setComments(data);
      if (offline) setConnected(false);
    } catch {
      setConnected(false);
    }
  }, [origin]);

  useEffect(() => {
    void load();
    return bridge.subscribe((ev) => {
      if (ev.type === 'status') {
        setConnected(ev.connected);
        if (ev.connected) void load();
      } else if (ev.type === 'comments-changed' && ev.origin === origin) {
        void load();
      }
    });
  }, [origin, load]);

  const pageComments = useMemo(() => comments.filter((c) => c.path === path), [comments, path]);

  // Previews run even when the overlay is hidden: removed stays removed.
  useEffect(() => {
    previews.setComments(pageComments.filter(isPreviewActive));
  }, [pageComments, previews]);

  // ---------- show / hide, per site ----------

  useEffect(() => {
    void chrome.storage.local.get(hiddenKey(origin)).then((r) => setHidden(r[hiddenKey(origin)] === true));
  }, [origin]);

  const setHiddenStored = useCallback(
    (value: boolean) => {
      setHidden(value);
      if (value) setMode({ type: 'idle' });
      void chrome.storage.local.set({ [hiddenKey(origin)]: value });
    },
    [origin],
  );

  // ---------- messages from the background (toggle, live capture for Claude) ----------

  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const exitCapture = useRef<(() => void) | null>(null);

  useEffect(() => {
    const finish = () => {
      exitCapture.current?.();
      exitCapture.current = null;
      previews.suspend(false);
    };
    const onMessage = (req: TabRequest, _sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void) => {
      if (req.type === 'toggle') {
        setHiddenStored(!hiddenRef.current);
        return false;
      }
      if (req.type === 'capture-done') {
        finish();
        return false;
      }
      if (req.type === 'prepare-capture') {
        void (async (): Promise<PrepareCaptureResponse> => {
          finish();
          // Claude wants to see what the code does now, so switch previews off.
          previews.suspend(true);
          const target = req.comment.target;
          const el = target ? findTarget(target) : null;
          let note: string | null = null;
          if (target && !el) {
            note =
              req.comment.kind === 'remove'
                ? 'The element was not found on the page, so it looks removed.'
                : 'The element was not found on the page with the stored selectors.';
          }
          if (el) {
            el.scrollIntoView({ block: 'center', inline: 'nearest' });
            await nextFrames(3);
          }
          const { rect, exit } = await enterCapture(el);
          exitCapture.current = exit;
          setTimeout(finish, 10_000); // safety net
          return { rect, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, note };
        })().then(sendResponse);
        return true;
      }
      return false;
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [previews, setHiddenStored]);

  // ---------- actions ----------

  const openThread = (id: number) => {
    setFocusId(null);
    setSidebarOpen(true);
    // set after a tick so the same id can be focused twice
    setTimeout(() => setFocusId(id), 0);
  };

  const show = (c: Comment) => {
    if (!c.target) return;
    const el = findTarget(c.target);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashId(c.id);
    setTimeout(() => setFlashId((f) => (f === c.id ? null : f)), 1600);
  };

  const onCreated = async (c: Comment) => {
    await load();
    setMode({ type: 'idle' });
    openThread(c.id);
  };

  if (hidden) return null;

  const pinned = pageComments.filter((c) => c.target && c.status !== 'accepted' && !isPreviewActiveRemove(c));
  const outlined = pageComments.find((c) => c.id === (flashId ?? hoverId));
  const openCount = pageComments.filter((c) => c.status === 'open' || c.status === 'in_progress').length;
  const reviewCount = pageComments.filter((c) => c.status === 'review_ready').length;

  return (
    <>
      {/* Sidebar first: popovers, pins and the picker render on top of it. */}
      {sidebarOpen && (
        <Sidebar
          comments={comments}
          path={path}
          connected={connected}
          focusId={focusId}
          onClose={() => setSidebarOpen(false)}
          onHover={setHoverId}
          onShow={show}
          onChanged={load}
        />
      )}

      {mode.type !== 'picking' && <Pins comments={pinned} onOpen={openThread} onHover={setHoverId} />}
      {outlined?.target && mode.type === 'idle' && <Outline target={outlined.target} flash={flashId === outlined.id} />}

      {mode.type === 'picking' && (
        <Picker
          onPick={(el) => setMode({ type: 'compose', el, kind: 'comment' })}
          onCancel={() => setMode({ type: 'idle' })}
        />
      )}
      {mode.type === 'compose' && (
        <Composer
          key={mode.el ? 'el' : 'page'}
          el={mode.el}
          initialKind={mode.kind}
          previews={previews}
          onCreated={onCreated}
          onCancel={() => setMode({ type: 'idle' })}
        />
      )}

      <Toolbar
        connected={connected}
        picking={mode.type === 'picking'}
        openCount={openCount}
        reviewCount={reviewCount}
        sidebarOpen={sidebarOpen}
        onPick={() => setMode(mode.type === 'picking' ? { type: 'idle' } : { type: 'picking' })}
        onPageComment={() => setMode({ type: 'compose', el: null, kind: 'comment' })}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        onHide={() => setHiddenStored(true)}
      />
    </>
  );
}

/** A removed element is hidden by its own preview, so it gets no pin. */
function isPreviewActiveRemove(c: Comment): boolean {
  return c.kind === 'remove' && isPreviewActive(c);
}
