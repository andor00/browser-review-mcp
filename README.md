# Browser Review

Review your own localhost dev app in Brave, Chrome or Firefox the way you would
in Figma, and let Claude Code fix it.

- **Comment** on the whole page or on one element. A numbered pin marks it.
- **Remove** an element (like an adblocker's element picker). It disappears right
  away, stays gone after a reload, and can be undone.
- **Edit** an element's text and CSS, with a live preview.
- Every comment, removal and edit becomes a task Claude reads over **MCP**, with
  selectors, HTML, React component names, the source file and screenshots.
- Claude marks a task **in progress**, fixes it in the code, and marks it
  **review ready** with a short note on how it solved it. You **accept** it or
  **reopen** it in the browser.

```
Brave extension  <---- WebSocket ---->  browser-review-mcp  <-- MCP (stdio) -->  Claude Code
(overlay, sidebar,                      127.0.0.1:4777                           (starts it per session)
 comments in IndexedDB)                 (npx, a bridge)
```

You never start a server yourself: Claude Code starts `browser-review-mcp` with
each session (like Browser MCP), and the extension connects to it. Comments live
in the extension, so you can review while no Claude session is open.

Works only on `http://localhost` and `http://127.0.0.1` pages. Everything stays
on your machine.

## Setup

### 1. Install the extension

**Brave, Chrome, Edge.** Until it is in the Chrome Web Store, load it unpacked:

1. Get the extension folder: extract a release zip (`browser-review-<version>-chrome.zip`, also for Brave and Edge; from the GitHub Releases page)
   into a folder you keep, for example `~/extensions/browser-review`, or build it
   from this repo (`extension/dist`, see Development).
2. Go to `brave://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick that folder.
4. Pin the icon (puzzle icon in the toolbar).

**Firefox (140 or newer).** Download `browser-review-<version>-firefox.xpi`
from the GitHub release (signed by Mozilla) and open it in Firefox. That installs
it for good. Without a signed release:

- To try it: `about:debugging`, **This Firefox**, **Load Temporary Add-on**, and
  pick the Firefox zip (`browser-review-<version>-firefox.zip`) or
  `extension/dist-firefox/manifest.json`. Firefox removes temporary add-ons
  (and their comments) when it closes.
- To keep it: it must be signed by Mozilla. Self-distribution works without a
  public listing: `npx web-ext sign --channel=unlisted --source-dir
  extension/dist-firefox` with API keys from addons.mozilla.org gives a signed
  `.xpi` you install by opening it in Firefox. (Firefox Developer Edition and
  Nightly can also run unsigned add-ons with `xpinstall.signatures.required`
  set to false in `about:config`.)

Comments are per browser: Brave and Firefox each keep their own.

The **help page** opens on install. It's also under right-click on the icon,
**Options** (Firefox: **Manage Extension**, **Preferences**), and behind the **?**
in the overlay. It shows the setup command and
whether Claude Code is connected.

Brave asks for access to all sites. That is only for screenshots: Chrome only
allows the screenshot API with that permission. The overlay itself only runs on
localhost.

### 2. Connect Claude Code (once)

Run this in a terminal (not inside Claude Code):

```sh
claude mcp add --scope user browser-review -- npx -y browser-review-mcp@latest
```

- `--scope user`: available in every project.
- `browser-review` is the name. The tools show up as
  `mcp__browser-review__list_comments` and so on.
- Needs Node.js 20 or newer for `npx`.

Check with `claude mcp list`: `browser-review` should say **Connected**. Start a
Claude Code session and the dot in the overlay (and on the help page) turns green.

Optional, no permission prompt for every tool: add this to
`~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["mcp__browser-review"]
  }
}
```

To remove it: `claude mcp remove --scope user browser-review`.

## Use it

1. Open your dev app, for example `http://localhost:5173`, and click the
   extension icon. The review sidebar opens.
2. Leave comments, removals and edits.
3. Open Claude Code in your **app's** project folder and say:

   > Check the review comments.

   Claude calls `list_comments`, then for each one `get_comment` (with the
   screenshot), `start_work` (shows **In progress**), fixes it in the code,
   optionally `capture_screenshot` to look at the result in your tab, and
   `submit_solution` with a short note (shows **Review ready**).

   More specific: *"Fix review comment #12."* or *"Check the review comments for
   http://localhost:5173 only."*
4. In the sidebar, **Accept solution** or write what is still wrong and **Reopen**.

### The overlay

| Action | How |
|---|---|
| Show the overlay with the Threads sidebar open (click again to hide) | the extension icon, or Alt+Shift+R |
| Comment on an element | **Pick element** (Alt+Shift+P), click the element, write, **Add comment** |
| Pick while holding a key | hold **Left Alt**, click the element; release Alt to stop. Change the key (or turn it off) on the help page. **Pick element** and its shortcut keep the picker on until you pick or press Esc |
| Pick the parent element | mouse wheel up or arrow up while picking (down goes back) |
| Remove an element | pick it, **Remove** tab, **Remove element**. It disappears |
| Edit text and CSS | pick it, **Edit** tab, change the texts, add CSS, **Save edit** |
| See the new thread right after sending | tick **Open thread** in the comment box (remembered). Off: only the Threads count goes up |
| Make the comment box taller | drag its bottom-right corner; the size is remembered |
| Make the Threads sidebar wider or narrower | drag its left edge (double-click it for the default width); the width is remembered |
| Comment on the page | **Page comment** (Alt+Shift+C) |
| See all threads | **Threads** (Alt+Shift+T): this page or the whole site, filtered by status |
| Jump to a thread's element | **Go to** in the thread. On another page it opens that page first. If the element is gone, you land on the page. **Open page** always opens the page itself. |
| Help | **?** in the toolbar or the sidebar |
| Change the shortcuts | they are browser shortcuts: help page, **Change shortcuts** (`brave://extensions/shortcuts`; Firefox: about:addons, gear, Manage Extension Shortcuts) |
| Save a comment | Ctrl+Enter |
| Cancel | Esc |

What you type survives a reload of your app (dev server restart, full HMR reload,
F5): an unsent comment, removal or edit reopens on the same element with your
text, and so do unsent replies. Drafts are kept per tab until you save, cancel
or close the tab.

On any other page, the extension icon (and the shortcuts) open a short note that
it only works on localhost, with buttons to switch to your open localhost tabs.
On a localhost tab that was open before you loaded the extension, it asks you to
reload the page.

### Statuses

| Status | Set by | Meaning |
|---|---|---|
| Open | you | waiting for Claude |
| In progress | Claude | Claude is working on it |
| Review ready | Claude | fixed, with a note on how; waiting for you |
| Accepted | you | done |

Claude can only set **In progress** and **Review ready**. Removals and edits are
shown as a preview while the status is Open or In progress. When Claude marks it
Review ready the preview turns off, so you see what the code really does now.
**Undo removal** / **Undo edit** brings the element back and drops the task.

### MCP tools

| Tool | What it does |
|---|---|
| `list_comments` | List comments. Default: open and in progress. Filter by status or site. |
| `get_comment` | Everything about one comment: page, selectors, HTML, React components, source file, requested change, thread, solution, plus the screenshot. |
| `get_screenshot` | The stored page or element screenshot. |
| `capture_screenshot` | A fresh screenshot from the open tab, with previews switched off, to check a fix. |
| `start_work` | Set to In progress. |
| `reply` | Write in the thread, for example to ask a question. |
| `submit_solution` | Set to Review ready with a note and the changed files. |

## Where the data lives

Comments, threads and screenshots are stored in the extension (IndexedDB in your
browser profile). Reloading or updating the extension keeps them; **removing the
extension deletes them**.

`browser-review-mcp` stores nothing. It listens on `ws://127.0.0.1:4777` and
passes Claude's tool calls to the extension. With several Claude Code sessions,
the first one holds the port and the others go through it; when it closes,
another takes over.

## Security

- The bridge listens on 127.0.0.1 only and checks the `Host` header (no DNS
  rebinding).
- Only the extension (a `chrome-extension://` or `moz-extension://` origin) may
  connect as the extension, and only local non-browser processes (other Claude Code sessions)
  as peers. Websites, including other localhost apps, get a 403.
- Nothing leaves your machine.

## Development

Needs Node 26 (`nvm use` reads `.nvmrc`) and pnpm.

### Run the extension from source (hot reload)

1. Install once:

   ```sh
   pnpm install
   ```

2. Start the watch and leave it running in a terminal:

   ```sh
   pnpm dev
   ```

   It builds the extension into `extension/dist` and rebuilds on every save.
   When it is ready it prints the folder to load and the `claude mcp add`
   command for the MCP server in this repo (step 5), with your paths filled in.

3. Load it in the browser, once:
   1. Open `brave://extensions` (or `chrome://extensions`) and turn on
      **Developer mode** (top right).
   2. If a release version of Browser Review is loaded, turn it off, so you
      don't get two overlays.
   3. Click **Load unpacked** and pick the `extension/dist` folder of this repo.

4. Open your app on `http://localhost:<port>` and work on the code. On every
   save the extension reloads itself, then reloads your localhost tabs so they
   get the new overlay. What you were typing in a comment box comes back.
   Changes in `extension/static/` (manifest, help page) reload it too.

5. To also use the MCP server from this repo instead of npm (no publish needed),
   run the command `pnpm dev` printed, once, then restart Claude Code:

   ```sh
   claude mcp remove --scope user browser-review
   claude mcp add --scope user browser-review -- node /path/to/repo/server/src/cli.ts
   ```

   Changes to the server take effect when Claude Code restarts it (`/mcp`,
   reconnect). To go back to npm: remove it again and add it with
   `npx -y browser-review-mcp@latest` (see Setup).

Good to know:

- **Stop the watch** (Ctrl+C) and nothing reloads anymore; the last build keeps
  working. `pnpm build` makes a normal build without hot reload, into the same
  `extension/dist`: while `pnpm dev` runs, save any file afterwards so the watch
  puts its own build back.
- **Separate comments.** An unpacked extension's ID, and with it its stored
  comments, depends on its folder. So `extension/dist` has its own comments,
  apart from a release folder you loaded before.
- **A build error** keeps the last good build running; fix it and save again.
- **Not reloading?** Check the watch is running and that port 4778 is free (it
  says so when it isn't). The extension's errors are under **Inspect views:
  service worker** on its card in `brave://extensions`.
- **How it works:** the watch serves its build number on `127.0.0.1:4778`; the
  dev build's background asks for it, and reloads when it changes
  (`extension/src/dev-reload.ts`). Normal and release builds leave that code out.

### Firefox

```sh
pnpm dev:firefox
```

Then `about:debugging`, **This Firefox**, **Load Temporary Add-on**, and pick
`extension/dist-firefox/manifest.json`. Hot reload works the same (port 4779,
so Chrome and Firefox watches can run side by side). Firefox drops temporary
add-ons, and their comments, when it closes; load it again after a restart.

### Checks

Run these before committing (CI runs the same):

```sh
pnpm typecheck
pnpm test               # all tests (the MCP one runs it over stdio like Claude Code)
pnpm build              # extension/dist, extension/dist-firefox, server/dist/cli.js
```

### Releasing

GitHub Actions (`.github/workflows/ci.yml`) does it:

- **Every push and pull request:** typecheck, tests, the Chrome/Brave/Edge zip,
  the Firefox zip (checked with Mozilla's `web-ext lint`) and the MCP package.
  Download them from the run's **Artifacts**.
- **On main, when the version changed:** a GitHub release `v<version>` with the
  files and release notes (install steps, plus the `feat`/`fix`/breaking
  commits since the last release). The version bumps itself from commit messages
  (below), so a `feat:` or `fix:` commit on main means a new release.
- **Then, once their keys are set:** Mozilla signs the Firefox add-on (a `.xpi`
  on the release), `browser-review-mcp` goes to npm, and the Chrome Web Store
  gets the new version for review. What to set up, and why "signing" differs
  per browser: [docs/releasing.md](docs/releasing.md).

By hand:

- **Extension zips:** `pnpm package` writes `release/browser-review-<version>-chrome.zip`
  (Chrome, Brave, Edge) and `release/browser-review-<version>-firefox.zip` (release builds,
  no sourcemaps). Brave can't install a zip directly: extract it and **Load
  unpacked**. The zips are also what the Chrome Web Store and
  addons.mozilla.org take. Check the Firefox one with
  `npx web-ext lint --source-dir extension/dist-firefox`.
- **MCP server on npm:** `pnpm publish:mcp` (needs `npm login` once). It builds
  `server/dist/cli.js`, runs the stdio test against the bundle, and publishes
  `browser-review-mcp`. pnpm refuses to publish with uncommitted changes.

The version is the same for both and bumps itself from Conventional Commit
messages: `fix:` bumps the patch, `feat:` the minor, `feat!:` or
`BREAKING CHANGE:` the major. Git hooks check the message and do the bump
(`pnpm install` turns them on). See [CLAUDE.md](CLAUDE.md).

### Layout

```
shared/      types used by both sides, including the bridge protocol
server/      browser-review-mcp: MCP over stdio + WebSocket bridge (npm package)
extension/   MV3 extension: background worker with the store (IndexedDB),
             overlay (Preact in a Shadow DOM), help page, notice popup.
             One code base; build.ts makes the Chromium and the Firefox build.
scripts/     version bumps from Conventional Commits
.githooks/   commit-msg check and post-commit version bump
docs/        plan
```

`BRM_PORT` changes the bridge port (default 4777), but the extension expects 4777.

## License

[MIT](LICENSE): free for everyone to use, change and share, also commercially.
Keep the copyright notice.
