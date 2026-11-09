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
- runs everything inside `main()`, so a truncated download executes nothing;
- writes only inside the Herdr config home (plus its own temp directory).

## Consequences

- A fresh user without a `keys.json` gets the mod but no shortcut until they add one; the installer says so.
- Merging into `keys.json` ends Herdr's automatic shortcut updates for that file; the installer and README say this.
- Reviewed over four rounds; the real download path was untested until the repo was pushed (see [test-installer](../runbooks/test-installer.md)).
