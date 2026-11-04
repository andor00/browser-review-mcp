// Content script entry: mounts the overlay in a Shadow DOM on localhost pages.
import { render } from 'preact';
import css from './styles.css';
import { App } from './App.tsx';
import { HOST_TAG } from './targets.ts';
import { initCapture } from './capture.ts';
import { Previews } from './previews.ts';

function mount(): void {
  if (document.querySelector(HOST_TAG)) return; // already injected (extension reloaded)
  const host = document.createElement(HOST_TAG);
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  const root = document.createElement('div');
  root.className = 'brm-root';
  shadow.append(style, root);

  // Keys typed in our textareas must not trigger the app's own shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress'] as const) {
    root.addEventListener(type, (e) => e.stopPropagation());
  }

  document.documentElement.appendChild(host);
  initCapture(shadow);
  render(<App previews={new Previews()} />, root);
}

mount();
