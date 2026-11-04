# Browser Review

Review your own localhost dev app in Brave the way you would in Figma, and let
Claude Code fix it.

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
Brave extension  <-- HTTP + WebSocket -->  review server  <-- MCP -->  Claude Code
(overlay, picker,                          127.0.0.1:4777
 sidebar)                                  SQLite + screenshots
```

Works only on `http://localhost` and `http://127.0.0.1` pages. Everything stays
on your machine.

## Requirements

- Node 26 (`nvm use` picks it up from `.nvmrc`)
- pnpm
- Brave (or another Chromium browser)
- Claude Code

## 1. Install and build

```sh
git clone https://github.com/andor00/browser-review-mcp.git
cd browser-review-mcp
nvm use
pnpm install
pnpm build
```

`pnpm build` writes the extension to `extension/dist/`.

## 2. Start the review server

```sh
pnpm server
```

You should see:

```
Browser Review server 0.1.0
  extension API  http://127.0.0.1:4777/api
  MCP            http://127.0.0.1:4777/mcp
  data           /home/you/.local/share/browser-review-mcp
```

Keep it running while you review. Comments are kept in the data folder, so you
can stop and start it at any time.

## 3. Load the extension in Brave

1. Go to `brave://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `extension/dist` folder.
4. Open your dev app, for example `http://localhost:5173`. A toolbar appears in
   the bottom right corner. The green dot means the extension is connected to
   the server.

After `pnpm build` (or while `pnpm dev:extension` runs), click the reload icon
on the extension card in `brave://extensions` and reload your app tab.

Brave asks for access to all sites. That is only for screenshots: Chrome only
allows the screenshot API with that permission. The overlay itself only runs on
localhost.

## 4. Add it to Claude Code

The review server is an MCP server over HTTP. You add it to Claude Code once.

### Add the server

Run this in a terminal (not inside Claude Code):

```sh
claude mcp add --transport http --scope user browser-review http://127.0.0.1:4777/mcp
```

- `--transport http`: the server speaks MCP over HTTP. There is no command for
  Claude Code to start, so the server must already be running (step 2).
- `--scope user`: available in every project. Leave this out (or use
  `--scope local`) to add it to the current project only.
- `browser-review` is the name. The tools show up as
  `mcp__browser-review__list_comments` and so on.

### Check that it works

```sh
claude mcp list
```

`browser-review` should say **Connected**. Inside Claude Code, `/mcp` shows the
same and lists the seven tools.

If it says it failed to connect, the review server is not running. Start it with
`pnpm server`, then reconnect from `/mcp` in Claude Code (or start a new
session).

### Optional: no permission prompt for every tool

Claude Code asks before it uses a tool from a new MCP server. To allow all
Browser Review tools, add this to `~/.claude/settings.json` (or to
`.claude/settings.json` in your app's project):

```json
{
  "permissions": {
    "allow": ["mcp__browser-review"]
  }
}
```

### Use it

Open Claude Code in your **app's** project folder (the code you are reviewing,
not this repo), and say:

> Check the review comments.

Claude then:

1. calls `list_comments` to see what is open,
2. calls `get_comment` for each one (with the element's screenshot),
3. calls `start_work`, so the comment shows **In progress** in your browser,
4. fixes it in the code,
5. can call `capture_screenshot` to look at the result in your open tab,
6. calls `submit_solution` with a short note, so the comment shows
   **Review ready**.

You can also be more specific:

> Fix review comment #12.

> Check the review comments for http://localhost:5173 only.

### Remove it again

```sh
claude mcp remove --scope user browser-review
```

## Using the overlay

| Action | How |
|---|---|
| Show or hide the overlay | the extension icon, or Alt+Shift+R |
| Comment on an element | **Pick element**, click the element, write, **Add comment** |
| Pick the parent element | mouse wheel up or arrow up while picking (down goes back) |
| Remove an element | pick it, **Remove** tab, **Remove element** |
| Edit text and CSS | pick it, **Edit** tab, change the texts, add CSS, **Save edit** |
| Comment on the page | **Page comment** |
| See all threads | **Threads** (this page or the whole site, filtered by status) |
| Save a comment | Ctrl+Enter |
| Cancel | Esc |

### Statuses

| Status | Set by | Meaning |
|---|---|---|
| Open | you | waiting for Claude |
| In progress | Claude | Claude is working on it |
| Review ready | Claude | fixed, with a note on how; waiting for you |
| Accepted | you | done |

Claude can only set **In progress** and **Review ready**. In the sidebar you
press **Accept solution**, or write what is still wrong and press **Reopen**.

Removals and edits are shown as a preview while the status is Open or In
progress. When Claude marks it Review ready the preview turns off, so you see
what the code really does now. **Undo removal** / **Undo edit** brings the
element back and drops the task.

## MCP tools

| Tool | What it does |
|---|---|
| `list_comments` | List comments. Default: open and in progress. Filter by status or site. |
| `get_comment` | Everything about one comment: page, selectors, HTML, React components, source file, requested change, thread, solution, plus the screenshot. |
| `get_screenshot` | The stored page or element screenshot. |
| `capture_screenshot` | A fresh screenshot from the open tab, with previews switched off, to check a fix. |
| `start_work` | Set to In progress. |
| `reply` | Write in the thread, for example to ask a question. |
| `submit_solution` | Set to Review ready with a note and the changed files. |

## Development

```sh
pnpm dev:server      # server with --watch
pnpm dev:extension   # rebuild the extension on every change
pnpm test            # server and extension tests
pnpm typecheck
```

Layout:

```
shared/      types used by both sides
server/      review server: HTTP API, WebSocket, MCP, SQLite (runs .ts directly on Node 26)
extension/   MV3 extension: background worker, overlay (Preact in a Shadow DOM), React probe
docs/        plan
```

Settings (environment variables for the server):

| Variable | Default |
|---|---|
| `BRM_PORT` | `4777` (the extension expects 4777) |
| `BRM_DATA_DIR` | `~/.local/share/browser-review-mcp` |

## Security

- The server listens on 127.0.0.1 only and checks the `Host` header (no DNS
  rebinding).
- The extension API only accepts requests from an extension, or from
  non-browser clients. Websites, including other localhost apps, get a 403.
- The MCP endpoint only accepts non-browser clients like Claude Code.
- Screenshots and comments stay in the local data folder.
