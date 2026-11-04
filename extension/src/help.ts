// The help page (help.html): setup command, live connection status, shortcuts.
import { MCP_ADD_COMMAND } from '@brm/shared';
import type { ContentRequest, StatusResponse } from './messages.ts';
import { HOLD_KEY, HOLD_KEYS, toHoldKey } from './settings.ts';

const $ = (id: string) => document.getElementById(id)!;

$('cmd').textContent = MCP_ADD_COMMAND;
$('version').textContent = chrome.runtime.getManifest().version;

// ---------- copy buttons ----------

for (const btn of document.querySelectorAll<HTMLButtonElement>('button[data-copy]')) {
  btn.addEventListener('click', () => {
    const text = $(btn.dataset.copy!).textContent ?? '';
    void navigator.clipboard.writeText(text).then(() => {
      btn.textContent = 'Copied';
      setTimeout(() => (btn.textContent = 'Copy'), 1500);
    });
  });
}

// ---------- live status ----------

async function refreshStatus(): Promise<void> {
  let s: StatusResponse | null = null;
  try {
    s = (await chrome.runtime.sendMessage({ type: 'status' } satisfies ContentRequest)) as StatusResponse;
  } catch {
    s = null;
  }
  const box = $('status');
  box.classList.toggle('is-on', !!s?.claude);
  if (s?.claude) {
    $('status-title').textContent = 'Claude Code is connected';
    $('status-text').textContent = `MCP server ${s.mcpVersion ?? ''} is running. Ask Claude to check the review comments.`;
  } else {
    $('status-title').textContent = 'Claude Code is not connected';
    $('status-text').textContent =
      'Do step 1 once, then start a Claude Code session. Your comments are saved in the meantime.';
  }
}
void refreshStatus();
setInterval(() => void refreshStatus(), 2000);

// ---------- shortcuts, as the user has them set ----------

const LABELS: Record<string, string> = {
  _execute_action: 'Show the sidebar (the extension icon)',
  'toggle-overlay': 'Show the overlay with the sidebar, or hide it',
  'pick-element': 'Pick an element',
  'page-comment': 'Comment on the whole page',
  'toggle-threads': 'Open or close the threads sidebar',
};

void chrome.commands.getAll().then((commands) => {
  const rows = $('shortcut-rows');
  for (const c of commands) {
    if (!c.name || c.name === '_execute_action') continue;
    const tr = document.createElement('tr');
    const action = document.createElement('td');
    action.textContent = LABELS[c.name] ?? c.description ?? c.name;
    const keys = document.createElement('td');
    if (c.shortcut) {
      c.shortcut.split('+').forEach((k, i) => {
        if (i > 0) keys.append('+');
        const kbd = document.createElement('kbd');
        kbd.textContent = k;
        keys.append(kbd);
      });
    } else {
      keys.textContent = 'not set';
      keys.style.color = 'var(--dim)';
    }
    tr.append(action, keys);
    rows.append(tr);
  }
});

// ---------- hold to pick ----------

const holdSelect = $('hold-key') as HTMLSelectElement;
for (const [code, label] of Object.entries(HOLD_KEYS)) holdSelect.add(new Option(label, code));
void chrome.storage.local.get(HOLD_KEY).then((r) => (holdSelect.value = toHoldKey(r[HOLD_KEY])));
holdSelect.addEventListener('change', () => void chrome.storage.local.set({ [HOLD_KEY]: holdSelect.value }));

// ---------- browser differences ----------

const isFirefox = navigator.userAgent.includes('Firefox/');

/** Firefox 137+ can open its shortcut settings; Chromium has a page for it. */
type CommandsWithSettings = typeof chrome.commands & { openShortcutSettings?: () => Promise<void> };

$('edit-shortcuts').addEventListener('click', () => {
  const commands = chrome.commands as CommandsWithSettings;
  if (isFirefox) {
    if (commands.openShortcutSettings) void commands.openShortcutSettings();
    else $('shortcuts-where').textContent = 'In Firefox: about:addons, gear icon, Manage Extension Shortcuts.';
    return;
  }
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// Firefox lets users switch off the extension's site access. Without it there is no overlay and no screenshots.
const ACCESS: chrome.permissions.Permissions = { origins: ['<all_urls>'] };
async function checkAccess(): Promise<void> {
  const granted = await chrome.permissions.contains(ACCESS).catch(() => true);
  $('access').hidden = granted;
}
$('grant').addEventListener('click', () => {
  void chrome.permissions.request(ACCESS).then(() => checkAccess());
});
void checkAccess();
