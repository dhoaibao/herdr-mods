# ADR-008: Split the view into feature modules and rename the mod to git-panel

- Status: Accepted
- Date: 2026-11-09
- Supersedes: none (the "main.js is not split up front" choice in the [expansion spec](../specs/git-panel-expansion.md) was a phase-time decision)

## Context

`main.js` grew from the graph view to 2,010 lines: state, refresh, the write path, the branch menu, the commit detail panel, diffs, search and the whole render. The tab modules (`prs.js`, `refs.js`, `config.js`, `history.js`) already follow one pattern, plain functions that take the view as `v`, so the file that did not follow it was the only one hard to read and to review. The mod also no longer is a graph: it has Refs, Pull requests and Config tabs and guarded writes, and `git-graph` undersold it.

## Decision

- The view class in `main.js` keeps the state, `init()`, the folder and refresh logic, `setTab()` and `blocked()`. Everything else moved, unchanged, into modules of functions taking `v`: `render`, `ops`, `writes`, `detail`, `diff`, `graph`, `log`, `menu`, `search`, `ui`, `shared`. The class keeps one-line forwarding methods only for what the tab modules call on the view (`button`, `small`, `field`, `pill`, `emptyState`, `op`, `confirm`, `writeBlock`, `refuse`, `clearSel`, `select`, `jumpTo`, `setDiff`, `diffView`, `detailPanel`), so `prs.js`, `refs.js`, `config.js` and `history.js` did not change.
- Imports point downwards only (`render` -> `detail` -> `writes` -> `ops` -> `shared`/`ui`); an upward call goes through a method of the view. A new feature gets its own module instead of growing `main.js`.
- The write path is untouched: `op()` and `confirmAction()` still are the only places a git write runs and a two-click action is armed, now in `ops.js`, and the guarded writes of [ADR-007](ADR-007-allow-guarded-local-writes.md) live together in `writes.js`.
- The mod is renamed `git-panel`: the folder `git-panel/mods/git-panel/`, the `mod.open:git-panel` key, the view class `GitPanel`, the installer target and the docs. The element ids keep their `gg-` prefix (they are internal and nothing outside the mod refers to them).

## Consequences

- Behavior is meant to be identical. It was checked by `bun run check`, `herdr-app check` and a token-level comparison of the old `main.js` against the new modules (only the forwarding methods and the renamed functions differ). The handlers still have no automated tests, so they need to be used in the app after a change like this.
- Someone who installed `git-graph` gets the migration from the installer ([ADR-004](ADR-004-installer-never-creates-keys-json.md)): the old folder moves to `<home>/backups/` and a `mod.open:git-graph` binding in `keys.json` is pointed at `git-panel`; where that cannot be done (symlinked or unusual `keys.json`, no `jq`, `--no-keys`) it prints what to change. Saved tabs and layouts that name `--mod git-graph` are theirs to recreate.
- The gallery page changes to `dhoaibao/herdr-mods--git-panel` once the renamed repo state is indexed; links to the old page break.
- The live-copy runbook now copies every `.js` file, and removes live files that no longer exist in the repo.
- Commits before this one still say `git-graph` and a single `main.js`; they describe what was true then.
