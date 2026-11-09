# herdr-mods

A collection of mods for the [Herdr](https://herdr.dev) desktop app. Each mod lives in its own folder and follows Herdr's sharing layout, so it can be installed by copying `mods/<name>/` into your Herdr config home.

| Mod | Description | Default key |
| --- | --- | --- |
| [git-graph](git-graph/) | Commit graph, everyday git operations and a GitHub pull-request browser | `ctrl-shift-g` |

## git-graph

A repository overlay with four tabs.

**Graph**
- Lane-based commit graph with ref chips, author and relative time, rendered in a virtual list.
- Branch menu: filter, switch, track a remote branch, or create a new one.
- Fetch, Pull (`--ff-only`) and Push with ahead/behind indicators. Push asks for a second click and never forces. A branch that never had an upstream is published with `push -u origin HEAD`; one whose upstream was deleted on the remote is not re-published (the mod tells you instead); otherwise it runs a plain `push`.
- Search the loaded commits by subject, author, ref name or hash: non-matches are dimmed, `Enter` and `Shift+Enter` step through the matches.
- Working-tree state: a count of the entries `git status` lists (an untracked folder counts once) and of conflicts beside the branch chip, and a banner while a merge, cherry-pick, revert, rebase or `git am` is in progress.
- Commit details with the full hash (Copy), clickable parents, author and committer, changed files, and per-file diffs with intra-line highlighting.
- Operation status is reported as plain text, including git's own error messages.

**Refs**
- Read-only lists: local branches (upstream, `↑n`/`↓n`, `gone`, and `merged` when reachable from HEAD), tags (annotated or not), stashes and the reflog (most recent 100). Click a stash to see its files and diff.

**Pull requests** (requires [`gh`](https://cli.github.com))
- Open, Merged and Closed lists with CI status, draft state, review decision, branch and author.
- Detail panel with checks, reviews, the rendered description and changed files; click a file to see its diff.
- Checkout (`gh pr checkout`), Open in browser, and Close (dismisses the detail panel only). Creating, reviewing, merging and closing PRs on GitHub are intentionally out of scope.

**Config**
- Read-only list of the effective git configuration (`git config --list --show-origin --show-scope`), grouped by section, with the scope (local, global, system, ...) and file each setting comes from.
- Filter by scope (All, Local, Global) and by text. Masking is best effort: credentials in URLs (including `url.<base>.insteadOf` keys) and proxy settings, `http.extraHeader`, and values of settings whose name contains `pass`, `token` or `secret` are hidden; other secrets stored under arbitrary keys are not. Editing configuration is intentionally out of scope.

![git-graph config tab](git-graph/preview-config.png)

### Requirements

- Herdr desktop app (not the TUI)
- `git`
- `gh`, authenticated, for the Pull requests tab

![git-graph preview](git-graph/preview.png)

### Install

```sh
curl -fsSL https://raw.githubusercontent.com/dhoaibao/herdr-mods/main/install.sh | sh
```

[`install.sh`](install.sh) downloads the repository tarball and copies `git-graph` into your Herdr config home. It refuses to overwrite an existing install. Apart from a temporary download directory, it writes only inside the config home. Read it before piping it to a shell.

Key binding: `keys.json` holds your whole keymap, so the installer never creates one (a file with a single key would replace Herdr's default shortcuts). If you already have one and `ctrl-shift-g` is free, it adds the binding with `jq` after saving a backup next to the file. Herdr treats any edited `keys.json` as yours and stops adding new default shortcuts to it. If `jq` is missing, the key is taken, there is no file, or the file is a symlink (dotfiles managers), the installer prints the line to add by hand.

| Option / variable | Effect |
| --- | --- |
| `sh -s -- --force` | Replace an existing install; the old copy moves to `<home>/backups/` |
| `sh -s -- --no-keys` | Leave `keys.json` alone |
| `HERDR_MODS_REF=<commit>` | Install a specific branch, tag or commit instead of `main` |
| `HERDR_APP_HOME=<dir>` | Use another Herdr config home (default `~/.config/herdr-app`) |
| `HERDR_MODS_SRC=<dir>` | Install from a local checkout of this repo instead of downloading |

Set variables on the `sh` side of the pipe: `curl -fsSL <url> | HERDR_MODS_REF=<commit> sh`. For a fully pinned install, use the same commit in the `install.sh` URL instead of `main`.

Manual install: copy `git-graph/mods/git-graph` to `~/.config/herdr-app/mods/`. If you have a `~/.config/herdr-app/keys.json` (a keys file is yours to merge, never replace), add [`git-graph/keys.json`](git-graph/keys.json) to it:

```json
{ "global": { "ctrl-shift-g": "mod.open:git-graph" } }
```

Herdr hot-reloads mods, so no restart is needed.

### Usage

Press `ctrl-shift-g` to open the overlay on the current folder. To open it as a tab with specific options:

```sh
herdr-app do tab.new --mod git-graph --props '{"folder":"/path/to/repo","tab":"prs","state":"open"}'
```

| Prop | Values | Meaning |
| --- | --- | --- |
| `folder` | path | Repository to show |
| `tab` | `graph`, `refs`, `prs`, `config` | Initial tab |
| `scope` | `all`, `local`, `global` | Initial scope filter of the Config tab |
| `state` | `open`, `merged`, `closed` | Initial pull-request filter |
| `pr` | number | Pull request to open in the detail panel |

## Security

Herdr mods are unsandboxed JavaScript with the same access as the app. `git-graph` runs these commands in the repository you open it on:

- `git`: `fetch --all --prune` (contacts remotes and removes stale remote-tracking refs), `pull --ff-only`, `push`, `switch` (including `--track` and `-c`) and read-only queries (`log`, `show`, `status --porcelain=v2`, `for-each-ref` (including `--merged HEAD`), `stash list`, `reflog`, `rev-list`, `rev-parse` (including `--git-path`, to detect a merge or rebase in progress), `symbolic-ref`, `config --get`, `config --list --show-origin --show-scope -z` for the Config tab).
- `gh`: `pr list`, `pr view`, `pr diff` (read-only, contact GitHub), `pr checkout` (may fetch from a fork and add a remote) and `pr view --web` (opens your browser).

It never creates, merges, reviews or closes pull requests, and never forces a push. Review the source before installing.

## Development

The running app loads `~/.config/herdr-app/mods/<name>/`; this repository holds the source of truth for sharing. Mirror changes between the two.

```sh
bun install                                       # dev tooling only (mods have no dependencies); also installs the git pre-commit hook
herdr-app check git-graph/mods/git-graph          # renders the initial state; also writes the .d.ts files
bun run check                                     # eslint, prettier --check, shellcheck, tsc
bun run format                                    # apply Prettier
```

`bun run typecheck` reads the type declarations Herdr writes into the mod folder (`gpui-kit.d.ts`, git-ignored; it declares `gpui-kit`, `gpui-base` and `herdr`), so run `herdr-app check` once first. The pre-commit hook (Husky, `.husky/pre-commit`) runs the same checks and skips `typecheck` or `shellcheck` with a warning when their prerequisite is missing; `bun run check` itself fails in that case. The hook checks the working tree, not only what is staged. Bypass it with `git commit --no-verify` or `HUSKY=0`; a git client that cannot find `bun` (exit 127) needs bun on its PATH, for example via `~/.config/husky/init.sh`. The mods run in Herdr's own runtime, so ESLint assumes no Node or browser globals.

`herdr-app check` does not exercise click handlers or later UI states, so test those in the app. See [`git-graph/RECIPE.md`](git-graph/RECIPE.md) for the build brief and known gpui-kit limitations, and [`AGENTS.md`](AGENTS.md) for contributor and agent guidance.
