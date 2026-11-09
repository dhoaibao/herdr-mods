# ADR-006: Share mods in Herdr's layout, installed by curl

- Status: Accepted
- Date: 2026-11-09
- Supersedes: none

## Context

Herdr lists community mods at herdr.dev/mods when a public GitHub repo has one folder per mod containing `mods/<name>/`, an optional `keys.json`, a `RECIPE.md` and a `preview.png`, plus the repo topic `herdr-mod`. Herdr tells an agent adding a mod to copy only `mods/<name>/` and merge keys. See the [reference](../references/herdr-mod-sharing.md).

## Decision

- The repo is a multi-mod collection: `<mod>/mods/<mod>/`, `<mod>/keys.json`, `<mod>/RECIPE.md`, `<mod>/preview.png`. Repo-level tooling (`package.json`, `install.sh`, docs) sits at the root and is never copied into a Herdr home.
- `RECIPE.md` follows Herdr's six-part format so another agent can rebuild the mod from it.
- `preview.png` is a screenshot of a throwaway demo repo, cropped to the overlay so no workspace names show.
- Besides the gallery, `install.sh` offers a one-line `curl | sh` install ([ADR-004](ADR-004-installer-never-creates-keys-json.md)).
- The repo copy is the shareable source; the live copy under `~/.config/herdr-app` is mirrored by hand.

## Consequences

- A second mod is a new top-level folder with the same shape; `install.sh` currently installs only `git-graph` and would need a mod argument.
- Gallery listing is outside our control (indexed within about an hour); the page for a subfolder mod is `herdr.dev/mods/<owner>/<repo>--<folder>/` (for this repo, `dhoaibao/herdr-mods--git-graph`), as seen in the gallery's markup for other mods.
