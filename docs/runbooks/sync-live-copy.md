# Sync the live copy

## Purpose

Keep the mod Herdr actually runs (`~/.config/herdr-app/mods/<mod>/`) identical to the repo copy (`<mod>/mods/<mod>/`), which is the source for sharing. Herdr hot-reloads the live folder.

## Prerequisites

- The Herdr desktop app is installed; `HERDR_APP_HOME` selects another config home if you use one.
- The repo copy passes `bun run check`.

## Steps

1. From the repo root, compare the two folders in both directions, skipping the files Herdr generates: `diff -rq -x jsconfig.json -x '*.d.ts' -x '*.error' git-graph/mods/git-graph "${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/git-graph"`.
2. Copy only the differing mod files (`main.js`, `prs.js`, `config.js`, `mod.json`, `*.svg`) into the live folder. Never copy `jsconfig.json` or `*.d.ts`, and never overwrite a file edited only in the live copy without looking at it first.
3. `herdr-app check "${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/git-graph"`.

## Verify

Repeat step 1: it prints nothing, and `herdr-app check` prints `check passed`. Open the overlay with `ctrl-shift-g` and confirm it paints.

## Troubleshooting

- A file differs in the live copy but not in the repo history: the live copy was edited directly; merge that change into the repo first.
- The overlay does not reload: toggle it closed and open (`ctrl-shift-g` twice); `herdr-app status` lists load errors.
