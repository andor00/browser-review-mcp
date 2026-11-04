interface Props {
  connected: boolean;
  picking: boolean;
  openCount: number;
  reviewCount: number;
  sidebarOpen: boolean;
  onPageComment: () => void;
  onPick: () => void;
  onToggleSidebar: () => void;
  onHide: () => void;
}

export function Toolbar(p: Props) {
  return (
    <div class="brm-ui brm-toolbar" role="toolbar" aria-label="Browser Review">
      <span
        class={`brm-dot ${p.connected ? 'is-on' : 'is-off'}`}
        title={p.connected ? 'Connected to the review server' : 'Review server not running. Start it with: pnpm server'}
      />
      <button class={`brm-tool ${p.picking ? 'is-active' : ''}`} onClick={p.onPick} title="Pick an element to comment on, remove or edit (Alt+Shift+P)">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 2l9 4.5-4 1.2L6.8 12z" />
        </svg>
        Pick element
      </button>
      <button class="brm-tool" onClick={p.onPageComment} title="Comment on the whole page (Alt+Shift+C)">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 3h11v7.5h-6L4.5 13v-2.5h-2z" />
        </svg>
        Page comment
      </button>
      <button class={`brm-tool ${p.sidebarOpen ? 'is-active' : ''}`} onClick={p.onToggleSidebar} title="Open or close the threads (Alt+Shift+T)">
        Threads
        {p.openCount > 0 && <span class="brm-count">{p.openCount}</span>}
        {p.reviewCount > 0 && <span class="brm-count st-review_ready" title="Review ready">{p.reviewCount}</span>}
      </button>
      <button class="brm-icon-btn" onClick={p.onHide} title="Hide the overlay (Alt+Shift+R or the extension icon brings it back)">
        ✕
      </button>
    </div>
  );
}
