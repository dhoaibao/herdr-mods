# Set up development

## Purpose

Get a working checkout where `bun run check` and the git pre-commit hook pass.

## Prerequisites

- `git` and [bun](https://bun.sh).
- The Herdr desktop app with `herdr-app` on `PATH` (needed to generate the type declarations and to preview).
- `shellcheck` (optional; the hook skips it with a warning when missing).

## Steps

1. Clone the repo and `cd` into it.
2. `bun install`. This installs the dev tooling and activates the Husky pre-commit hook (`core.hooksPath=.husky/_`).
3. `herdr-app check git-panel/mods/git-panel`. It renders the mod once and writes the git-ignored `gpui-kit.d.ts` and `jsconfig.json` next to it, which `tsc` needs.
4. `bun run check` (ESLint, Prettier check, shellcheck, tsc).
5. Format with `bun run format` before committing.

## Verify

`bun run check` exits 0, and a commit triggers the same steps through the hook.

## Troubleshooting

- `tsc` reports TS2307 for `gpui-kit`, `gpui-base` or `herdr`: step 3 was skipped, so `gpui-kit.d.ts` is missing.
- A git client commits with exit 127 and `bun: not found`: put bun on the client's `PATH`, or in `~/.config/husky/init.sh`. `git commit --no-verify` or `HUSKY=0` bypasses the hook.
- The hook blocks a commit because of an unrelated, unstaged file: it checks the working tree, not only the index.
- `herdr-app check` only renders the initial state; test clicks and later states in the app.
