# git-graph expansion

Status: implemented (P1-P5 committed; P6 implemented)

## Goal

Show more of the information developers need and add safe, local write actions to `git-graph`, in small phases that each ship on their own.

## Decisions

- Writes: create-only actions plus housekeeping (branch/tag here, detached checkout, stash push/apply, delete merged branch with `-d`, rename, stash pop/drop, cherry-pick/revert, Abort).
- No staging or commit UI; committing stays with Herdr's Changes panel.
- Branch, tag and stash management lives in a new Refs tab (`refs.js`).
- New modules only (`refs.js`, `status.js`; `diff.js` extracted when the stash diff needs it). `main.js` is not split up front.

## Requirements

### Read-only information

- R1 Working-tree state: changed-entry and conflict count pill (the entries `git status --porcelain=v2 -z` lists); banner for merge, cherry-pick, revert or rebase in progress; upstream name as tooltip on the ahead/behind pills.
- R2 Commit detail: full hash with Copy (`cx.write_to_clipboard`), clickable parent hashes that select and scroll to the commit, author email, committer when different.
- R3 Commit search: filter input that dims non-matching loaded rows (lane layout unchanged), match count, Next.
- R4 Refs tab: branches (`%(upstream:short)`, `%(upstream:track)`, merged marker), tags, stashes (`stash list`, `stash show` reusing the diff view), reflog (`-n 100`).
- R5 File history from commit detail: `log --follow -n 100 -- <path>`.
- R6 Current-branch PR chip (shown only after the Pull requests tab was opened in that view, because the `ctrl-shift-g` overlay cannot pass props to switch it off) and extra PR fields (`mergeable`, `mergeStateStatus`, `labels`, `reviewRequests`); verify field names against `gh` first.

### Safe writes

- W1 `branch <name> <hash>`, `tag [-a -m] <name> <hash>`, `switch --detach <hash>`.
- W2 `stash push --include-untracked -m`, `stash apply <sha>`, `stash pop stash@{n}` only after `rev-parse` confirms it still equals the clicked hash.
- W3 `branch -d` (merged only, never the current branch), `branch -m old new`, stash drop with the same hash check.
- W4 `cherry-pick <hash>` / `revert --no-edit <hash>` only with no modified tracked files; merge commits refused; Abort via `<op> --abort`.

### Safety model

1. Every write goes through `op()`; targets (full hash, branch, stash hash) are captured at click time.
2. One click for ref-creating actions; two clicks (generalize `armed` to an action key, 5 s window, ADR-003 border) for removing, remote-changing or history-creating actions.
3. Names pass the existing regex plus `git check-ref-format --branch`; a leading `-` is refused; hashes match `^[0-9a-f]{40,64}$`.
4. Guards: clean tracked tree for cherry-pick/revert; nothing runs mid-merge/rebase except Abort; no branch actions on a detached HEAD where a branch is required.
5. No data-loss commands. Show the dropped stash hash in the success note.
6. Status stays plain text (ADR-002); name inputs are rows in the detail or Refs panel.

## Phases

| Phase | Content | Review |
| --- | --- | --- |
| P1 | R1 + R2; `status.js`; fix the stale props table in the README (`tab` lacks `config`, `scope`) | bounded, may skip |
| P2 | R3 search | bounded, may skip |
| P3 | R4 Refs tab, read-only | bounded, may skip |
| P4 | W1 + W2; new ADR-007 "Allow guarded local writes" | independent `b-review` |
| P5 | W3 + W4 + Abort banner; update ADR-007 | independent `b-review` |
| P6 | R5 + R6 | bounded, may skip |

## Acceptance criteria

Per phase, on a throwaway demo repo:

- P1: pill counts the entries `git status` lists (modified and untracked; an untracked folder counts once); a conflicting `git merge` shows the MERGING banner with the conflict count; Copy puts the full hash on the clipboard; clicking a parent selects and scrolls to it.
- P2: match count is right, non-matches are dimmed, lanes unchanged, Next scrolls to the next match.
- P3: `[gone]` and ahead/behind match `git branch -vv`; clicking a stash shows its files and diff; reflog lists 100 entries.
- P4: each action works; `-x`, `a..b`, `x.lock` are refused before git runs; stash apply after a new `stash push` applies the right stash; errors show git's text.
- P5: `branch -d` on an unmerged branch shows git's refusal; the current branch has no Delete; cherry-pick with a dirty tree is refused; a conflicting cherry-pick shows the banner and Abort (two clicks) restores HEAD; stash drop with a stale index is refused.
- P6: file history jumps to commits; the PR chip shows on a branch with a PR and nothing appears otherwise.

Every phase: `herdr-app check git-graph/mods/git-graph` passes, `bun run check` passes, `node --check` passes on every module (add `config.js` and new files to RECIPE's Done when), live copy mirrored with `diff -rq` clean, README Security compared by hand against `rg -n 'op\(|exec\(' git-graph/mods/git-graph/*.js`, RECIPE and `docs/architecture/git-graph.md` updated, `preview.png` retaken in P1 and P4 per the runbook.

## Risks

- `status` on the 5 s refresh may be slow on large repos; measure in P1, fall back to `--untracked-files=no`.
- Hooks or GPG signing can hang cherry-pick, revert or annotated tags until the 120 s timeout; document in RECIPE.
- Rebase detection via `rev-parse --git-path` plus `readTextFile` is untested (including remote `on`); confirm in P1.
- `gh` field names for R6 are unverified.
- No automated tests; pure parsers could be tested with `bun test` but that widens ADR-005 (open item).
- Toolbar space at narrow widths; hide the search box when the overlay is not wider than 820 px (room beside the branch chip, pills and Fetch/Pull/Push); a hidden search counts as empty.

## Out of scope

Rebase, reset, clean, discarding changes, `branch -D`, `stash clear`, deleting remote branches, force-push, `--no-verify`, any GitHub write (ADR-001), staging/commit/amend, blame, worktree management (Herdr's `worktree` mod), pushing a single tag (W5).
