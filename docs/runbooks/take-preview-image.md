# Take the preview image

## Purpose

Produce `<mod>/preview.png`, the picture Herdr's gallery shows, without leaking real project or workspace names.

## Prerequisites

- The Herdr desktop app is running and `herdr-app` is on `PATH`.
- Python 3 with Pillow, or another way to crop a PNG.

## Steps

1. Build a throwaway demo repo in a scratch folder: a few commits by fake authors, two or three feature branches, merges, and a tag or two, with `main` checked out.
2. Open a temporary tab on it: `herdr-app do tab.new --mod git-panel --props '{"folder":"<demo repo>","tab":"graph"}'`. Note the returned `tab` id.
3. Wait about 3 s, then `herdr-app shot <scratch>/raw.png`. The screenshot is the whole window.
4. Close the tab: `herdr-app do tab.close --id <tab id> --confirmed true`.
5. Crop to the overlay only (the right-hand pane; for a 1920 x 1048 frame that was `(298, 48, 1912, 496)`) and save as `git-panel/preview.png`.

For the Config tab image (`git-panel/preview-config.png`), give the demo repo a local config with fake values only (name, email, a remote URL with a fake token to show the masking), open the tab with `--props '{"folder":"<demo repo>","tab":"config","scope":"local"}'` so the global `~/.gitconfig` and its path stay out of the frame, and crop the same way. If the focused space is on another machine, pass `--space <local space id>` to `tab.new`, `space.select` it for the shot, close the tab, and select the previous space again.

## Verify

Open the PNG: it shows only the mod, with demo authors, and no sidebar, workspace names or personal data. The file should also carry no text or EXIF chunks.

## Troubleshooting

- The tab shows `Not a git repository`: `folder` must be the demo repo's absolute path.
- The crop is off: the frame size depends on the window; look at `raw.png` and adjust the box.
- Do not take the screenshot on a real repo: author names and branch names would be published.
