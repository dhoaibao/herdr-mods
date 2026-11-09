# git-graph architecture

## Scope

How the `git-graph` mod (`git-graph/mods/git-graph/`) is built today: a Herdr desktop-app overlay with a commit graph tab, a Refs tab (branches, tags, stashes, reflog), a GitHub pull-request tab and a read-only git config tab. What it shows and how it behaves is in [`git-graph/RECIPE.md`](../../git-graph/RECIPE.md); this page covers structure and data flow.

## Components

| Part | Where | Role |
| --- | --- | --- |
| `GitGraph` view | `main.js` | The one `View` subclass Herdr instantiates. Holds all state, runs git, renders both tabs. |
| `location()`, `parseLog()`, `layout()` | `main.js` | Pure helpers: where the focused terminal is; split `git log` output into commits; assign each commit a lane and the joins/branches per row. |
| PR tab | `prs.js` | Functions that take the view as `v` and keep their state on it under `pr*` names (loading, selection, checkout, the toolbar and the panel); see its exports. |
| Working-tree state | `status.js` | `parseStatus()` counts the entries and conflicts that `git status --porcelain=v2 -z` lists (an untracked folder is one entry); `inProgress()` names a merge, cherry-pick, revert, rebase or `git am` in progress by probing marker files under the git dir (`rev-parse --git-path` plus `readTextFile`). Pure reads; `refresh()` stores the result in `work` and `inprog`. |
| Refs tab | `refs.js` | Same pattern as `prs.js` with `refs*` state: five read-only reads (`for-each-ref` for branches, merged branches and tags, `stash list`, `reflog`), pure parsers (`parseBranches`, `parseTags`, `parseStashes`, `parseReflog`), the toolbar and the virtual lists. The lists are read-only; the only writes in this file are the branch and stash actions of ADR-007 (`renameBranch`, `deleteBranch`, `stashChanges`, `applyStash`, `removeStash` for pop and drop), all run through the view's `op()`. It also owns `validRefName()`, shared with `main.js`. A stash opens in the commit detail panel of `main.js` through `select()` and `detailPanel(t, mono, commit)`. |
| Config tab | `config.js` | Same pattern as `prs.js` with `cfg*` state: runs `git config --list --show-origin --show-scope -z`, `parseConfig()` splits it into settings, `maskKey()` and `maskValue()` hide credentials in keys and values, then the toolbar and panel render them. Read-only. |
| Icons | `*.svg` | `branch`, `fetch`, `pull`, `push`, `more`; drawn in the button text color. |
| Placement | `mod.json` | Overlay, 1200 x 900. |
| Key | `git-graph/keys.json` | `ctrl-shift-g` -> `mod.open:git-graph`. |

External surface (all from Herdr's built-in modules, typed by the generated `gpui-kit.d.ts`): `gpui-kit` (`View`, `div`, `svg`), `gpui-base` (layout helpers, `Input`, `v_virtual_list`, `VirtualListScrollHandle`, `TextView`), `herdr` (`spaces`, `panes`, `focused`, `exec`, `readTextFile`, `watchFolder`, `theme`, `settings`, `props`).

## Flow

1. **Open.** `init()` reads `props`, picks the tab (prop, else the tab used last: `LAST_TAB`), and restores the last graph read for the same folder from the module-level `CACHE`, so the first paint is instant. It then starts a 5 s timer that calls `refresh()`.
2. **Where.** `where()` is `props.folder` when given, otherwise the focused pane's cwd (`location()`, also resolving a remote machine). `ctx()` is that value as a string; a change of context resets branch, rows and selection.
3. **Refresh.** `refresh()` finds the repo root once (`rev-parse --show-toplevel`), then reads `for-each-ref`, `rev-parse HEAD`, `symbolic-ref` and `rev-list --left-right --count @{upstream}...HEAD`, `status --porcelain=v2` and the in-progress probe from `status.js` (these update `work`/`inprog` on every refresh and repaint when they change, but are not part of the graph signature); with no upstream it also reads `config --get branch.<name>.merge` to tell "never had one" from "deleted on the remote". `branch`, `sync` and `upstreamGone` are assigned together, after the `config --get` read and before the graph read, so Push never sees a mixed state. The graph itself (`git log`, 400 per page) is re-read only when the signature of refs, HEAD, branch, counts and limit changed. A `watchFolder` loop triggers extra refreshes for local repos.
4. **Render.** `render()` builds the tab row, the controls row, the note bar, the body and the detail panel. Lists use `v_virtual_list` with handlers on the list (`on_item_click`), never inside a row renderer. Rows get a lane column from `layout()` output. The commit search is a view-side filter: `render()` calls `hits()`, which finds matches among the loaded rows (memoized on the rows array and the text), and `row()` only dims non-matches and tints the current match; no git command is involved.
5. **Act.** Fetch, Pull, Push, branch switch/create, the guarded writes of [ADR-007](../decisions/ADR-007-allow-guarded-local-writes.md) (branch/tag/detached checkout at a commit, cherry-pick and revert, `--abort` of the operation in progress, branch rename and delete, stash push/apply/pop/drop) and PR checkout all go through `op()`: one operation at a time, `exec(cmd, argv, { cwd: root })` with no shell, the result shown as text in the note bar, then a forced `refresh()`. `op()` can run a read-only precondition first (`extra.check`) and show a refusal instead; a two-click action (Push, stash pop and drop, branch delete, cherry-pick, revert, abort) is armed by `confirm(key)`, which holds one action key for 5 s; the key names the full target (the commit, the stash hash, the branch and its hash, the operation), so arming one target never arms another.
6. **Inspect.** Selecting a commit runs `git show` (message, `--numstat`, `--name-status`, `-m --first-parent`); a file click runs `git show` for that path and `setDiff()` builds the rows, `markWords()` the intra-line highlight. The PR tab does the same with `gh pr view` and `gh pr diff`, parsed by `splitDiff()`.

## Ownership and boundaries

- The view owns all state; helper functions in `prs.js` mutate it through `v`. Nothing outlives the overlay except `CACHE` and `LAST_TAB`.
- Read-only git is run with `--no-optional-locks` and `core.fsmonitor=false` so the mod's own reads never trigger its folder watch. The Config tab's `git config --list` is the exception: it takes no locks, and those `-c` flags would show up as `command`-scope rows.
- The lists of the Refs tab and the Config tab only read (`for-each-ref`, `stash list`, `reflog`, `config --list`). Writes to git are limited to `fetch --all --prune`, `pull --ff-only`, `push`, `switch` (including `--track`, `-c` and `--detach`), and the guarded writes of [ADR-007](../decisions/ADR-007-allow-guarded-local-writes.md): `branch <name> <hash>`, `tag` (lightweight or `-a -m`), `stash push --include-untracked`, `stash apply <hash>`, `stash pop stash@{n}` and `stash drop stash@{n}`, `branch -m`, `branch -d`, `cherry-pick`, `revert --no-edit` and `--abort` for a merge, rebase, cherry-pick or revert; writes through `gh` to `pr checkout` (a local branch switch). The mod never closes, merges, reviews or creates a PR. See the ADRs below.
- The repo copy is the source for sharing; the running app loads `~/.config/herdr-app/mods/git-graph/`. They are kept in sync by hand ([runbook](../runbooks/sync-live-copy.md)).

## Related ADRs

- [ADR-001](../decisions/ADR-001-keep-github-access-read-only.md), [ADR-002](../decisions/ADR-002-report-status-as-plain-text.md), [ADR-003](../decisions/ADR-003-guard-push.md), [ADR-007](../decisions/ADR-007-allow-guarded-local-writes.md).
