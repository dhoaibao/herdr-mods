# Publish a mod to the Herdr gallery

## Purpose

Make a mod appear at herdr.dev/mods.

## Prerequisites

- A public GitHub repo with, per mod, a folder containing `mods/<name>/`, `RECIPE.md` and `preview.png` (see [take-preview-image](take-preview-image.md)).
- `RECIPE.md` in Herdr's six-part format ([reference](../references/herdr-mod-sharing.md)).
- Everything committed and pushed; you are signed in to GitHub as the repo owner.

## Steps

1. `bun run check` and push `main`.
2. On the repo page, open the gear next to **About**, add the topic `herdr-mod` and save. (In a narrow browser window GitHub's compact layout may put **About** below the file list.)
3. Wait up to an hour; Herdr says the mod shows up "within the hour".
4. Open `https://herdr.dev/mods/<owner>/<repo>--<folder>/` (for this repo: `https://herdr.dev/mods/dhoaibao/herdr-mods--git-graph/`) or search the gallery for the owner. The `<repo>--<folder>` form is how other subfolder mods appear in the gallery; it is not documented by Herdr.

## Verify

- `curl -s https://api.github.com/repos/<owner>/<repo>` shows `"private": false` and `"herdr-mod"` in `topics`.
- The repo is in the list at `https://github.com/topics/herdr-mod`.
- The gallery page for the mod shows the preview and the recipe.

## Troubleshooting

- Not listed after an hour: confirm the repo is public and the topic is exactly `herdr-mod` (singular).
- `gh repo edit --add-topic` returns 404: the active `gh` account cannot see the repo; run `gh auth status` and `gh auth switch`, or add the topic in the web UI.
- Every `herdr.dev/mods/...` URL returns 200, even wrong ones (a generic fallback page), so check the page title or content, not the status code.
