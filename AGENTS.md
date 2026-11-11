<!-- b-init-managed:start -->
# Agent Instructions

## Repository Purpose

Source repo for Herdr desktop-app mods, one folder per mod, laid out like a Herdr config home (`<mod>/mods/<mod>/`, optional `keys.json`, `RECIPE.md`, `preview.png`). Currently ships `git-panel`. Origin: `dhoaibao/herdr-mods`.

## Project Operating Guide

### Architecture and change map

- `git-panel/mods/git-panel/main.js`: the `View` class (state, refresh, tabs) that forwards to the feature modules, which are functions taking the view as `v` (ADR-008): `render.js` (layout), `ops.js` (the one write path `op()`, the two-click confirm, fetch/pull/push), `writes.js` (guarded commit writes), `detail.js`/`diff.js` (commit panel and diffs), `graph.js`/`log.js` (rows, lanes, log parsing), `menu.js` (branch menu), `search.js`, `ui.js` (widgets), `shared.js` (constants), `refs.js`, `config.js`, `status.js`, `history.js`. `prs.js`: Pull requests tab (uses `gh`). `prwrites.js`: the guarded GitHub writes (merge, close, ready for review, delete head branch) and their action bar (ADR-009). `mod.json`: overlay size/placement. `*.svg`: button icons. A new feature goes in its own module, not into `main.js`.
- `git-panel/keys.json`: keys the mod expects; users merge it into `~/.config/herdr-app/keys.json`.
- `git-panel/RECIPE.md`: brief to rebuild the mod. Update it when behavior or gotchas change.
- `README.md`: mod table, trust note, install steps.
- `install.sh`: curl-installable POSIX installer (tarball download, never overwrites without `--force`, adds `ctrl-shift-g` to an existing `keys.json` only when free and never creates one, moves an old `git-graph` mod to `<home>/backups/` and points a `mod.open:git-graph` binding at `git-panel` (ADR-004), since a one-key file would replace Herdr's default shortcuts). Keep the README install table in step with its options and variables.
- `git-panel/preview.png` (Graph tab) and `git-panel/preview-config.png` (Config tab, opened with `"scope":"local"` so `~/.gitconfig` stays out): cropped `herdr-app shot` of the mod on a throwaway demo repo; never include the Herdr sidebar or real workspace names.

### Canonical sources and generated files

- The repo copy is a snapshot. The running app loads `~/.config/herdr-app/mods/<mod>/` and hot-reloads it; Herdr writes `jsconfig.json`, `gpui-kit.d.ts` and `herdr.d.ts` there (git-ignored). Keep the two copies in sync by hand; do not edit the live copy without mirroring the change here.
- gpui-kit and herdr APIs: `~/.config/herdr-app/{AGENTS.md,herdr.d.ts,gpui-kit.d.ts}`.

### Constraints

- Mods are unsandboxed JS that run `git` and `gh`. The mod never forces a push and never creates or reviews PRs on GitHub; its only GitHub writes are the two-click merge, close, ready-for-review and delete-head-branch of ADR-009 (never `--admin`, auto-merge or `gh`'s branch-delete flag), and beyond fetch, pull, push, branch switching and `gh pr checkout` its local writes are limited to the set in ADR-007 (the PR detail's "Hide" only dismisses the local panel); keep it that way unless the user asks. Keep the Security section of `README.md` in step with every `git`/`gh` subcommand the code runs.
- gpui-kit limits (no handlers in `v_virtual_list` renderers, no `occlude`, reuse of `cx`) are listed in `git-panel/RECIPE.md`.
- Preview with `herdr-app shot <file.png>` on a temporary tab (`herdr-app do tab.new --mod <name> --props '{...}'`, then `tab.close`); do not alter the user's layout or keys.

### Documentation

See [docs/README.md](docs/README.md) for where docs go and how to name them.

## Verification

- `bun install` (also activates the Husky pre-commit hook, `.husky/pre-commit`, which runs the same checks and skips `typecheck`/`shellcheck` with a warning when `gpui-kit.d.ts`/`shellcheck` are missing), then `bun run check` (ESLint, Prettier check, shellcheck, `tsc` type check; it fails when a prerequisite is missing). The hook checks the working tree, not only the index; bypass with `--no-verify` or `HUSKY=0`. Scripts: `lint`, `typecheck`, `format`, `format:check`, `shellcheck`. Dev tooling only; mods have no dependencies, and `package.json`/`bun.lock` are not part of an install.
- `typecheck` needs the git-ignored `gpui-kit.d.ts` Herdr writes into the mod folder (it declares `gpui-kit`, `gpui-base` and `herdr`): run `herdr-app check git-panel/mods/git-panel` first on a machine with Herdr (they are absent on a fresh clone and in CI).
- `herdr-app check git-panel/mods/git-panel` (renders the initial state only).
- `shellcheck install.sh` (also in `bun run check`); test it offline with a throwaway `HERDR_APP_HOME` and `HERDR_MODS_SRC=$PWD`, never against the real config home.
- Gap: no automated tests; handlers and later UI states need manual use in the app.
<!-- b-init-managed:end -->

## Project Rules
