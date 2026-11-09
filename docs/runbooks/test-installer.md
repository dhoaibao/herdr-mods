# Test the installer

## Purpose

Check `install.sh` without touching your real Herdr config, offline first and then through a real download.

## Prerequisites

- `sh`, `dash`, `shellcheck`, `jq` (needed for the key merge), `curl` and `tar`.
- A shell in the repo root.
- For the download test: the script and mod are pushed to GitHub, and the repo is public.

## Steps

1. `bun run shellcheck` (also `sh -n install.sh` and `dash -n install.sh`).
2. Offline runs against a throwaway home with a local checkout as the source: `H=$(mktemp -d) && HERDR_APP_HOME=${H:?} HERDR_MODS_SRC=$PWD sh install.sh` (the `${H:?}` stops the run if `mktemp` failed, so it can never fall back to your real config home). Cover each case in a fresh home:
   - no `keys.json`: mod installed, `keys.json` not created;
   - `keys.json` with a free key: merged, a timestamped backup next to it, other keys preserved;
   - `ctrl-shift-g` already bound: left alone;
   - a second run without `--force`: refused, nothing changed; with `--force`: the old copy is under `$H/backups/`;
   - a symlinked `keys.json`, or one holding two JSON documents: untouched, manual line printed;
   - `--no-keys`, a missing `$H`, and a `$H` containing spaces.
3. Real download into a throwaway home: `H=$(mktemp -d) && curl -fsSL https://raw.githubusercontent.com/dhoaibao/herdr-mods/main/install.sh | HERDR_APP_HOME=${H:?} sh`. Pin a commit with `HERDR_MODS_REF=<sha>` (on the `sh` side of the pipe).

## Verify

`"$H/mods/git-panel/mod.json"` exists, no `"$H"/.install-*` or `"$H"/.keys.json.*` leftovers remain, and `herdr-app check "$H/mods/git-panel"` passes.

## Troubleshooting

- `download failed for ref '<ref>'`: the ref does not exist or the repo is private (raw URLs return 404 for private repos).
- Variables placed before `curl` do not reach `sh`; put them after the pipe.
- Never run these tests against your real `~/.config/herdr-app`.
