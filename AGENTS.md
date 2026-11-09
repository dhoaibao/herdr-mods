<!-- b-init-managed:start -->
# Agent Instructions

## Repository Purpose

Source repo for Herdr desktop-app mods, one folder per mod, laid out like a Herdr config home (`<mod>/mods/<mod>/`, optional `keys.json`, `RECIPE.md`, `preview.png`). Currently ships `git-graph`. Origin: `dhoaibao/herdr-mods`.

## Project Operating Guide

### Architecture and change map

- `git-graph/mods/git-graph/main.js`: shell, Graph tab, git operations. `prs.js`: Pull requests tab (uses `gh`). `mod.json`: overlay size/placement. `*.svg`: button icons.
- `git-graph/keys.json`: keys the mod expects; users merge it into `~/.config/herdr-app/keys.json`.
- `git-graph/RECIPE.md`: brief to rebuild the mod. Update it when behavior or gotchas change.
- `README.md`: mod table, trust note, install steps.

### Canonical sources and generated files

- The repo copy is a snapshot. The running app loads `~/.config/herdr-app/mods/<mod>/` and hot-reloads it; Herdr writes `jsconfig.json`, `gpui-kit.d.ts` and `herdr.d.ts` there (git-ignored). Keep the two copies in sync by hand; do not edit the live copy without mirroring the change here.
- gpui-kit and herdr APIs: `~/.config/herdr-app/{AGENTS.md,herdr.d.ts,gpui-kit.d.ts}`.

### Constraints

- Mods are unsandboxed JS that run `git` and `gh`. The mod never forces a push and never creates, merges, reviews or closes PRs on GitHub (PR "Close" only dismisses the local detail panel); keep it that way unless the user asks. Keep the Security section of `README.md` in step with every `git`/`gh` subcommand the code runs.
- gpui-kit limits (no handlers in `v_virtual_list` renderers, no `occlude`, reuse of `cx`) are listed in `git-graph/RECIPE.md`.
- Preview with `herdr-app shot <file.png>` on a temporary tab (`herdr-app do tab.new --mod <name> --props '{...}'`, then `tab.close`); do not alter the user's layout or keys.

### Documentation

See [docs/README.md](docs/README.md) for where docs go and how to name them.

## Verification

- `herdr-app check git-graph/mods/git-graph` (renders the initial state only).
- `node --check git-graph/mods/git-graph/main.js` and `.../prs.js` (syntax).
- Gap: no automated tests; handlers and later UI states need manual use in the app.
<!-- b-init-managed:end -->

## Project Rules
