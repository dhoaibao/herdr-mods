# Herdr mod sharing

- Source: `~/.config/herdr-app/AGENTS.md` (shipped with the app; sections "Layouts and mods other people made", "Keys: `keys.json`" and the mod file list), the output of `herdr-app --help` (for `HERDR_APP_HOME`), and the gallery at https://herdr.dev/mods (its page markup for the entry URL form)
- Retrieved: 2026-11-09
- Version: herdr-app 0.1.14, gpui-shell 0.7.1

## Summary

How a mod is laid out, shared and installed in Herdr, and what the gallery expects.

## Key facts

- A mod folder holds `main.js` (required; default-exports a class extending `View`), `mod.json` (where it appears: `place`, `size`, `overlay`, `focusable`) and optional extra `*.js` modules and `*.svg` icons. Herdr writes `jsconfig.json` and `.d.ts` files into it.
- To share: a public GitHub repo, one folder per mod, a `RECIPE.md`, a `preview.png`, and the repo topic `herdr-mod`. The mod appears at herdr.dev/mods "within the hour".
- `RECIPE.md` is a brief another agent can rebuild the mod from, in this order: `# Name` with one paragraph and `![Name](preview.png)`; **What you see**; **How it behaves**; **Built from**; **Watch out**; **Done when**. Exact values (colors, sizes, commands) over vague ones.
- When asked to add a shared mod, Herdr's guidance is: read the recipe and every file first; tell the person if the mod reaches the network or runs programs; copy only `mods/<name>/` (not the recipe or preview); never overwrite a name that is taken; merge the mod's `keys.json` and ask before replacing a key already used; run `herdr-app check`.
- `keys.json` is "what every key does": the whole keymap, live-reloaded. An untouched file is refreshed with new default shortcuts on upgrade; any edit, even whitespace, makes the file the person's. `ctrl-alt-shift-escape` sets `keys.json` and the layout aside and returns to defaults.
- `HERDR_APP_HOME` selects another config home (default `~/.config/herdr-app`).
- Gallery entries are keyed `owner/repo` or, for a mod in a subfolder, `owner/repo/<folder>` (seen in the gallery's page markup). A mod page is `/mods/<owner>/<repo>/` or, for a subfolder, `/mods/<owner>/<repo>--<folder>/` with `/` in the folder path written as `--` (for example `/mods/sodiumsun/agenttrail--herdr--agenttrail/`), and the owner is spelled as on GitHub. Every `herdr.dev/mods/...` path returns HTTP 200, so the status code does not prove an entry exists.

## Implications for this repo

- Layout and `RECIPE.md` follow these rules ([ADR-006](../decisions/ADR-006-share-mods-in-herdr-layout.md)).
- The installer must not create or overwrite `keys.json` ([ADR-004](../decisions/ADR-004-installer-never-creates-keys-json.md)).
- Because the mod runs `git` and `gh`, the README must say so before anyone installs it.
- Re-read the source when herdr-app is upgraded; the gallery rules may change.
