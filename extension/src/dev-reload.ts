// Hot reload for development, only in `node build.ts --watch` builds: there
// __DEV_RELOAD__ is the URL of the build server, otherwise null, so the call in
// background.ts is dead code and esbuild leaves this module out.
//
// The background long-polls the build id. When a new build is out it reloads
// the extension (new background, content scripts, pages), and the new
// background reloads the localhost tabs, whose old content scripts are cut off
// by the reload. What was being typed in the overlay survives (drafts).

const BASELINE_KEY = 'devReloadBuild'; // storage.session: build this extension was loaded at
const RELOAD_TABS_KEY = 'devReloadTabs'; // storage.local: reload the tabs after our own reload

/** `url`: the build server's /build. `tabs`: match patterns of the tabs to reload. */
export function startDevReload(url: string, tabs: string[]): void {
  void (async () => {
    const { [RELOAD_TABS_KEY]: reloadTabs } = await chrome.storage.local.get(RELOAD_TABS_KEY);
    if (reloadTabs) {
      await chrome.storage.local.remove(RELOAD_TABS_KEY);
      for (const tab of await chrome.tabs.query({ url: tabs })) if (tab.id !== undefined) void chrome.tabs.reload(tab.id);
    }
    // storage.session is emptied by a reload, and survives the service worker sleeping.
    let { [BASELINE_KEY]: baseline } = (await chrome.storage.session.get(BASELINE_KEY)) as { [BASELINE_KEY]?: string };
    for (;;) {
      // An extension API call keeps the service worker awake while we wait.
      await chrome.runtime.getPlatformInfo();
      let id: string;
      try {
        const res = await fetch(`${url}?since=${encodeURIComponent(baseline ?? '')}`, { cache: 'no-store' });
        id = await res.text();
      } catch {
        await new Promise((r) => setTimeout(r, 2000)); // watch not running (yet)
        continue;
      }
      if (!baseline) {
        baseline = id;
        await chrome.storage.session.set({ [BASELINE_KEY]: id });
      } else if (id !== baseline) {
        console.log('Browser Review: new build, reloading');
        await chrome.storage.local.set({ [RELOAD_TABS_KEY]: true });
        chrome.runtime.reload();
        return;
      }
    }
  })();
}
