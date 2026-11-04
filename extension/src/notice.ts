// The action popup shown where the overlay cannot run (see showNotice in background.ts).
import { isLocalUrl } from './local.ts';

const params = new URLSearchParams(location.search);
const reason = params.get('reason') === 'not-loaded' ? 'not-loaded' : 'not-localhost';
const $ = (id: string) => document.getElementById(id)!;

async function main(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $(reason).hidden = false;

  if (reason === 'not-loaded') {
    $('reload').addEventListener('click', () => {
      if (tab?.id !== undefined) void chrome.tabs.reload(tab.id);
      window.close();
    });
    return;
  }

  $('here').textContent = tab?.url ? shortUrl(tab.url) : 'not a web page';

  const local = (await chrome.tabs.query({})).filter((t) => t.url && isLocalUrl(t.url));
  if (local.length === 0) {
    $('no-tabs').hidden = false;
    return;
  }
  $('tabs').hidden = false;
  const list = $('tab-list');
  for (const t of local) {
    const btn = document.createElement('button');
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = t.title || shortUrl(t.url!);
    const url = document.createElement('span');
    url.className = 'url';
    url.textContent = shortUrl(t.url!);
    btn.append(title, url);
    btn.addEventListener('click', () => {
      if (t.id !== undefined) void chrome.tabs.update(t.id, { active: true });
      void chrome.windows.update(t.windowId, { focused: true });
      window.close();
    });
    const li = document.createElement('li');
    li.append(btn);
    list.append(li);
  }
}

function shortUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:' ? `${url.protocol}//${url.host}${url.pathname}` : u;
  } catch {
    return u;
  }
}

void main();
