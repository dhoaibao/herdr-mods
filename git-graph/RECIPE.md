# git-graph

A repository overlay for the Herdr desktop app: a colored commit graph with everyday git buttons, and a GitHub pull-request browser. `ctrl-shift-g` opens it on the repo of the focused terminal; click a commit to read its message and diff, click a pull request to see its checks, reviews and files.

![git-graph](preview.png)

## What you see

An overlay, 1200 × 900 (`mod.json`: `{ "place": "none", "overlay": { "width": 1200, "height": 900 } }`), with a 10 px rounded frame, a 1 px border and the theme background. Every color is a theme token (`accent`, `ansi1`–`ansi6`, `ansi10`, `muted`, `dim`, `border`, `hover`, `selected`, `raised`, `popover`); nothing is hard-coded. Monospace text uses the theme's mono font.

Top to bottom:

1. **Tabs row**, 46 px: `Graph` and `Pull requests`, 14 px text, a 2 px accent underline under the active one. No title.
2. **Controls row**, 46 px, per tab.
   - Graph: a branch chip (accent border, branch icon, name truncated at 220 px, `▾`), then `↓n` (ansi3) and `↑n` (ansi2) for behind/ahead, and on the right the buttons `Fetch`, `Pull`, `Push`. Buttons are 28 px high, 12 px side padding, 6 px radius, 1 px border, 13 px text, each with a 14 px icon in the button's text color (`fetch.svg`, `pull.svg`, `push.svg`, `branch.svg`).
   - Pull requests: three filter buttons `Open`, `Merged`, `Closed` (the active one has an accent border) and a `Reload` button with the fetch icon.
3. **Note bar**, only while an operation runs or has a result: at least 30 px high, `raised` background, plain text. Running is muted, success is ansi2 (`Fetch: done`, cleared after 5 s), failure is ansi1 and holds the last four lines of git's or gh's message. No spinner and no check icon.
4. **Body.**
   - Graph: a list of 28 px rows. Left, a lane column 16 px per lane (at most 10 lanes) wide: 2 px vertical lane lines in a palette cycling `accent, ansi2, ansi3, ansi5, ansi6, ansi1, ansi4, ansi10`, rounded bends where a lane joins or branches off, and an 8 px node (filled; a merge commit's node is hollow with the lane color as border). Then ref chips (20 px high, 1 px border, 12 px text: current branch accent, tag ansi3, remote branch ansi4, local branch ansi2), the commit subject, the author (130 px, muted) and the relative time (105 px, dim). Under 560 px width the author is dropped and the time becomes the 7-character hash.
   - Pull requests: a list of 32 px rows: an 8 px CI dot (ansi1 fail, ansi3 pending, ansi2 pass, border color when there are no checks), `#number` (52 px, dim), the title, a branch chip (ansi4, up to 260 px), the author (120 px, wide layout only) and the age (90 px, dim).
5. **Detail panel** below the list, only after a selection.
   - Commit: 340 px high, a 40 px header (accent short hash, `N files changed`), the full message (first 60 lines) and a list of changed files (28 px rows: status letter A ansi2 / D ansi1 / other `blocked` color, path, `+n` ansi2, `−n` ansi1).
   - Pull request: 440 px high, a 40 px header with `#number`, the title and the buttons `Checkout`, `Open in browser`, `Close`. Wide layout: two columns, the left (info) flexible and the right (`FILES (n)`) 440 px with a left border. Narrow layout: the same two blocks stacked, each half of the height. The info column has the title (15 px semibold), the state chip (`Draft` muted, `Merged` ansi5, `Closed` ansi1, `Open` ansi2), `head → base`, `+additions −deletions N files`, a CHECKS list (8 px state dot, name, state), a REVIEWS list (author, state in ansi2 for approved and ansi1 for changes requested) and the description rendered as markdown.
   - A clicked file replaces the panel body with its diff: 22 px rows, two 44 px line-number gutters, an 18 px `+`/`−` column, added lines on an ansi2 tint and removed lines on an ansi1 tint (the color at alpha `30`), hunk headers on a `raised` row with the range in accent, and the changed words inside a changed line highlighted. A `‹ Files` button (commit) or `‹ Details` button (PR) in the header returns to the list.
6. **Footer**, Graph only, 44 px, when more history exists: `Showing N commits` and a `Load more` button (adds 400).
7. **Branch menu**: a 380 px popover at (14, 50) with a filter input and 28 px rows, up to 380 px high. Rows show `●` for the current branch, `remote` in ansi4 for remote-only branches, and a first row `Create branch "<typed>"` in accent when the typed name is valid and does not exist.

## How it behaves

- **Which repo.** `props.folder` pins it to one folder. Otherwise it follows the focused pane (its cwd, or the space folder; on a remote machine it runs there). It shows `Not a git repository` when there is none, `No commits yet` for an empty repo and `Loading history…` while reading.
- **Opening.** `mod.open:git-graph` toggles the overlay (pressing the key again closes it). A tab or pane works too: `herdr-app do tab.new --mod git-graph --props '{"folder":"/repo","tab":"prs","state":"merged","pr":8}'`. Props: `folder` (path), `tab` (`graph` | `prs`; default is the tab last used), `state` (`open` | `merged` | `closed`), `pr` (a positive integer, preselects that PR). The last graph read for each folder is kept at module scope, so reopening paints at once and refreshes in the background.
- **Refresh.** Every 5 s, and when a watched folder changes (local repos). The graph is re-read only when the refs, HEAD, branch, ahead/behind or limit changed. The PR list is re-read at most once a minute unless a filter changes.
- **Graph reads** use `git log --branches --remotes --tags HEAD --date-order -n 400` plus `for-each-ref`, `rev-parse`, `symbolic-ref`, `rev-list --left-right --count @{upstream}...HEAD` and `config --get branch.<name>.merge`, all read-only (`--no-optional-locks`, `core.fsmonitor=false`).
- **Clicking a commit** loads its message and changed files; clicking the same commit again closes the panel. Clicking a file shows that commit's diff for the file; a merge commit shows the diff against its first parent.
- **Fetch** runs `git fetch --all --prune`. **Pull** runs `git pull --ff-only` and is disabled on a detached HEAD. The label becomes `Pull ↓n` when behind.
- **Push** needs two clicks: the first turns the button into `Click again to push ↑n` with an ansi1 border for 5 s, the second runs it. It never forces. A branch that never had an upstream runs `git push -u origin HEAD`; a branch whose upstream was set but no longer exists on the remote is refused with a note instead of being re-published. A detached HEAD shows `Detached HEAD: switch to a branch to push`.
- **Branch menu.** Click the chip, type to filter. A local branch runs `git switch <name>`, a remote-only one `git switch --track <remote/name>`, the create row `git switch -c <name>`. New names must match `^[A-Za-z0-9_][A-Za-z0-9._/-]*$`, contain no `..`, and not end in `/` or `.lock`. Branch names that start with `-` are never listed.
- **One operation at a time.** While one runs the others are ignored. When it ends the graph is re-read.
- **Menu click-through.** There is no occlusion in gpui-kit, so clicks that dismiss or pick from the menu would also hit what is under it; the view ignores clicks while the menu is open and for 400 ms after it closes.
- **Pull requests** (needs `gh`): `gh pr list --state <open|merged|closed> --limit 50 --json …` in gh's default order (the age column shows the last update); an empty list reads `No <state> pull requests`. `Reload` re-reads it. Clicking a row loads `gh pr view <n> --json …` and `gh pr diff <n>`; clicking the row again closes the panel. `Checkout` runs `gh pr checkout <n>` (one click, a local branch switch). `Open in browser` runs `gh pr view <n> --web` and is hidden for a repo on a remote machine. `Close` only closes the panel; the mod never closes, merges, reviews or creates a PR on GitHub.
- **Errors** from git or gh show as text in the note bar, or in the list area when the list itself fails.

## Built from

- `main.js`, default-exporting a class that extends `View` (`init(props, cx)`, `render`), from `gpui-kit` (`View`, `div`, `svg`) and `gpui-base` (`v_flex`, `h_flex`, `InputState`, `Input`, `Scrollbar`, `v_virtual_list`, `TextView` in `prs.js`).
- `prs.js`, the Pull requests tab: list rows, detail panel, `gh` calls. It takes the view as `v` and keeps its state on it under `pr*` names.
- `herdr` functions: `spaces`, `panes`, `focused` (where the focused terminal is), `exec` (every git and gh call, argv array, no shell, `cwd` set to the repo root), `watchFolder`, `theme`, `settings`, `props`.
- Virtual lists with `on_item_click` on the list: `gg-list` (commits, 28 px), `gg-prs` (PRs, 32 px), `gg-branches` (menu, 28 px), `gg-diff` (22 px).
- Icons: `branch.svg`, `fetch.svg`, `pull.svg`, `push.svg`, `more.svg`, drawn in the button's text color.
- Programs run: `git` and, for the second tab, `gh`.
- Key binding, in `keys.json`: `{ "global": { "ctrl-shift-g": "mod.open:git-graph" } }`.

## Watch out

- No handlers inside a `v_virtual_list` renderer: put them on the list (`on_item_click`).
- No `occlude`: see the menu click-through rule above.
- Children of a scrolling column need `flex_none`, or wrapped lines overlap. Give every panel a fixed pixel height or the scroll columns spill out.
- Never reuse a `cx` after an `await`; use the one the async callback receives. `cx.timer` exists on async contexts.
- `mod.open` is a toggle: it closes an already open overlay.
- `herdr-app check <mod folder>` only renders the initial state, so handlers and later states are never exercised by it. Take a picture with `herdr-app shot file.png` after opening a temporary tab with `tab.new --mod git-graph --props …`, then close it with `tab.close --id <tab> --confirmed true`.
- A throwaway demo repo is best for screenshots (the preview was taken on one with fake authors); the Herdr sidebar shows workspace names, so crop to the overlay.
- Do not add a spinner or check-mark state to the note bar; status is plain text on purpose.
- The Pull requests tab is read-only on GitHub by design: no create, review, merge or close.
- Push never uses force and never re-publishes a branch whose remote was deleted; keep both.

## Done when

- `herdr-app check git-graph/mods/git-graph` prints `check passed` and `node --check` passes for `main.js` and `prs.js`.
- Opening the overlay on a repo with branches and merges shows the graph with colored lanes, ref chips, authors and relative times, and the branch chip shows the current branch.
- `Fetch`, `Pull` and `Push` show `↓n` and `↑n` when the branch is behind or ahead, and `Push` needs a second click within 5 s.
- In a repo whose branch had its upstream deleted on the remote, `Push` shows the refusal note and runs nothing.
- Clicking a commit shows its message and files; clicking a file shows a diff with two gutters and highlighted changed words.
- On the Pull requests tab, `Open`, `Merged` and `Closed` list up to 50 PRs, a row opens the detail panel with checks, reviews, the markdown description and files, and a file opens its diff.
- `Checkout` switches to the PR's branch, `Open in browser` opens the PR page, and `Close` only closes the panel.
- With `{"pr":8}` and `{"tab":"prs"}` in the props the PR tab opens with PR 8 selected; `{"pr":-5}` or `{"pr":"8a"}` select nothing.
