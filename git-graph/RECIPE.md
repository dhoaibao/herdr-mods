# git-graph

A Herdr desktop mod: a git commit graph and a GitHub pull-request browser in one overlay.
Open it with `ctrl-shift-g` (`mod.open:git-graph`), or as a tab/pane:

```
herdr-app do tab.new --mod git-graph --props '{"folder":"/path/to/repo","tab":"prs","state":"merged","pr":8}'
```

Props: `folder` (repo path), `tab` (`graph` | `prs`), `state` (`open` | `merged` | `closed`), `pr` (PR number).

## Layout

- `mod.json`: `{ "place": "none", "overlay": { "width": 1200, "height": 900 } }`
- A top row of two tabs, **Graph** and **Pull requests** (no title). Each tab's controls sit on a second row below.
- Built as a JS `View` class with `gpui-kit`. `main.js` is the graph and shell, `prs.js` is the PR tab.
- Icons are SVG files next to the code: branch, fetch, pull, push, more.

## Graph tab

- Lane-based commit graph with rounded bends, ref chips, author and relative time, 28 px rows, virtual list.
- Branch chip with a caret opens a filterable menu: switch branch, track a remote branch, create a branch.
- Fetch, Pull (`--ff-only`) and Push buttons with ahead/behind arrows. Push needs two clicks (armed for 5 s), never forces, and runs `push -u origin HEAD` only when the branch never had an upstream (`branch.<name>.merge` unset). If an upstream is configured but its remote-tracking ref is gone, it refuses and explains instead of re-publishing. Branch names starting with `-` are hidden from the branch menu.
- "Load more" in a footer.
- Status of each git operation shows as plain text in a note bar (running, done, or git's error). No spinners or checkmark states.
- Click a commit to see its message and changed files; click a file for its diff (intra-line word highlighting, two line-number gutters).
- Cache the last graph per folder at module scope so reopening paints instantly; reuse the repo root between refreshes.

## Pull requests tab (needs `gh`)

- Open / Merged / Closed filter, 50 rows: CI dot, draft flag, review decision, branch chip, author, age.
- Detail panel in two columns: info, checks, reviews and markdown description (`TextView.markdown`) on the left, changed files on the right. Clicking a file shows its diff. Stacks vertically when narrow.
- Buttons: Checkout (`gh pr checkout`), Open in browser (`gh pr view --web`), Close (dismisses the detail panel only; never `gh pr close`). Read-only on GitHub otherwise: no create, review, merge or close.

## gpui-kit gotchas

- No handlers inside `v_virtual_list` renderers; use `on_item_click` on the list.
- There is no `occlude`, so clicks pass through overlays. Ignore them while a menu is open or for 400 ms after it closes.
- Children of scrolling columns need `flex_none`, or wrapped lines overlap. Give panels fixed pixel heights.
- Never reuse a `cx` after an await. `mod.open` toggles an already-open overlay closed.
- `herdr-app check` renders only the initial state; use `herdr-app shot` for visuals.
