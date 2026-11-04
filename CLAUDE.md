# Browser Review

A Brave/Chromium extension plus a local review server, so the user can comment on,
remove and edit elements of their localhost dev app and Claude picks the comments up
over MCP. See README.md for how it works and how to use it.

## Layout and commands

```
shared/      types used by both sides
server/      review server: HTTP API, WebSocket, MCP, SQLite (runs .ts directly on Node 26)
extension/   MV3 extension: background worker, overlay (Preact in a Shadow DOM), notice popup
scripts/     version.ts: Conventional Commit checks and version bumps
.githooks/   commit-msg and post-commit hooks (enabled by `pnpm install`)
```

```sh
pnpm server          # start the review server (127.0.0.1:4777)
pnpm build           # build the extension into extension/dist
pnpm test            # all tests
pnpm typecheck       # all packages
```

After changing the extension: run `pnpm typecheck`, `pnpm test` and `pnpm build`.
When a change is visible to the user (a button, shortcut, behaviour), update the
README too.

## Commits: Conventional Commits

Every commit message must follow [Conventional Commits](https://www.conventionalcommits.org/).
The `commit-msg` hook rejects anything else.

```
<type>(<optional scope>)<optional !>: <summary in the imperative, lower case>

<optional body: what and why>

<optional footer, e.g. BREAKING CHANGE: what breaks and how to migrate>
```

| Type | Use for | Version bump |
|---|---|---|
| `feat` | a new feature the user can see or use | **minor** 0.1.0 → 0.2.0 |
| `fix` | a bug fix | **patch** 0.1.0 → 0.1.1 |
| `perf` | a speed-up without behaviour change | **patch** |
| `refactor` | code change, no behaviour change | none |
| `docs` | README, CLAUDE.md, comments | none |
| `style` | formatting only | none |
| `test` | tests only | none |
| `build` | build script, dependencies, tooling | none |
| `ci` | CI config | none |
| `chore` | anything else that is not shipped | none |
| `revert` | reverting an earlier commit | none |

A `!` after the type/scope (`feat!:`, `fix(api)!:`) or a `BREAKING CHANGE:` footer
makes it a **major** bump (0.4.2 → 1.0.0), whatever the type. Breaking means the user
has to do something: the MCP tools change shape, the extension API changes, stored
data or settings no longer load, the Node version requirement goes up.

Scopes in use: `extension`, `server`, `shared`, `mcp`, `overlay`, `sidebar`, `deps`.

Examples:

```
feat(overlay): add keyboard shortcuts for pick, page comment and threads
fix(sidebar): keep the reply draft after a reload
feat(mcp)!: rename get_comment to get_task

BREAKING CHANGE: Claude Code sessions must use get_task instead of get_comment.
docs: explain the localhost-only notice
```

One logical change per commit. If a change has both a feature and a fix, the
highest bump wins, so a `feat` commit may include the fixes it needed.

## Versioning: Semantic Versioning, automatic

The version follows [SemVer](https://semver.org/): `MAJOR.MINOR.PATCH`.

- The root `package.json` `"version"` is the single source of truth.
- It is copied into `shared/`, `server/` and `extension/` `package.json` and
  `extension/static/manifest.json`. The server reads its version from its
  `package.json` at runtime.
- **Never edit version numbers by hand.** The `post-commit` hook reads the commit
  message, bumps the version (table above), syncs all files and amends the bump into
  the same commit. It prints `Version x.y.z (level)` when it does.
- It does not bump again when the commit already changes the version (for example
  `git commit --amend`), nor during rebase, cherry-pick or merge.
- If it says the version files have uncommitted changes, commit or stash those
  first, then run the command it prints.

By hand, when really needed:

```sh
pnpm version:bump patch|minor|major   # bump and sync
pnpm version:sync                     # copy the root version into every file
```

Do not use `git commit --no-verify` unless the user asks for it: it skips the
message check (the version bump still runs).

The hooks are enabled by `pnpm install` (the `prepare` script sets
`core.hooksPath` to `.githooks`). In a fresh clone without install, run
`git config core.hooksPath .githooks`.
