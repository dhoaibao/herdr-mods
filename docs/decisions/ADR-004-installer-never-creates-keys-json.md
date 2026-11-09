# ADR-004: The installer never creates keys.json or overwrites a mod

- Status: Accepted
- Date: 2026-11-09
- Supersedes: none

## Context

`install.sh` is meant to run as `curl ... | sh`. Herdr documents `keys.json` as "what every key does" and says any edit makes the whole file the user's. A `keys.json` created with only `ctrl-shift-g` would therefore replace Herdr's default shortcuts.

## Decision

The installer:

- copies the mod to a staging folder, then moves it into `mods/`; it refuses to replace an existing install unless `--force`, in which case the old copy goes to `<home>/backups/` (outside `mods/`, so Herdr does not load it);
- never creates `keys.json`; with an existing plain-JSON file and a free `ctrl-shift-g` it merges with `jq` after a timestamped backup, otherwise it prints the line to add;
- leaves a symlinked or non-regular `keys.json` alone;
- after the rename `git-graph` -> `git-panel` ([ADR-008](ADR-008-split-into-feature-modules-and-rename.md)), moves an old `mods/git-graph` folder to `<home>/backups/git-graph-<timestamp>` (the same reversible move as `--force`, never a delete) and, in a plain single-document `keys.json`, changes the value `mod.open:git-graph` to `mod.open:git-panel` with `jq` after a timestamped backup. It changes only that value, so the key the user chose stays; otherwise (symlinked or non-regular `keys.json`, two documents, no `jq`, `--no-keys`) it leaves the file alone and prints what to change. With `jq` it only counts a binding when `mod.open:git-graph` is a value, not a key (without `jq` it searches the text, and only prints the note), and it never writes an empty result;
- runs everything inside `main()`, so a truncated download executes nothing;
- writes only inside the Herdr config home (plus its own temp directory).

## Consequences

- A fresh user without a `keys.json` gets the mod but no shortcut until they add one; the installer says so.
- Merging into `keys.json` ends Herdr's automatic shortcut updates for that file; the installer and README say this.
- Reviewed over four rounds; the real download path was untested until the repo was pushed (see [test-installer](../runbooks/test-installer.md)).
