# ADR-007: Allow Guarded Local Writes

- Status: Accepted
- Date: 2026-11-09
- Supersedes: none (extends [ADR-003](ADR-003-guard-push.md); [ADR-001](ADR-001-keep-github-access-read-only.md) still holds)

## Context

The mod could fetch, pull, push and switch branches. Developers also need to mark a commit (branch or tag), park work in a stash and bring it back, tidy merged branches, bring one commit onto the current branch (or undo one) and back out of a conflicted operation, without leaving the overlay. The mod is unsandboxed JavaScript that runs `git`, so each write has to be limited to what cannot lose committed work.

## Decision

Allowed writes, all local, all through the view's `op()` (one at a time, argv array with no shell, the context checked, git's own error text shown, then a forced refresh):

| Action | Command | Clicks |
| --- | --- | --- |
| Branch here | `git branch <name> <hash>` | 1 |
| Tag here | `git tag <name> <hash>`, or `git tag -a <name> -m <msg> <hash>` with a message | 1 |
| Check out a commit detached | `git switch --detach <hash>` | 1 |
| Stash changes | `git stash push --include-untracked [-m <msg>]` | 1 |
| Apply a stash | `git stash apply <hash>` | 1 |
| Pop a stash | `git stash pop stash@{n}` | 2 |
| Drop a stash | `git stash drop stash@{n}` | 2 |
| Rename a branch | `git branch -m -- <old> <new>` | 1 |
| Delete a merged branch | `git branch -d -- <name>` | 2 |
| Cherry-pick a commit | `git cherry-pick <hash>` | 2 |
| Revert a commit | `git revert --no-edit <hash>` | 2 |
| Abort an operation in progress | `git merge\|rebase\|cherry-pick\|revert --abort` | 2 |

Rules:

- **Two tiers.** An action that only creates a ref or stash entry, applies one, or renames a branch takes one click. An action that removes an entry (`pop`, `drop`, `branch -d`), creates a commit (`cherry-pick`, `revert`) or discards the work on an operation (`--abort`) takes two: the first arms it for 5 s with an ansi1 button (`confirm()`, generalizing the Push guard of ADR-003 from a flag to an action key), the second runs it. The key names the whole target, so arming one target never lets a single click run on another, and closing the item or opening another branch drops the pending arm:
  - `cherry-pick` and `revert`: `<kind>:<hash>:<branch>`, the commit and the branch it lands on.
  - `pop` and `drop`: `<verb>:<stash@{n}>:<hash>`, the stash entry and its commit (two entries can hold the same commit).
  - `branch -d`: `del:<hash>:<name>`, the branch and its hash.
  - `--abort`: `abort:<kind>:<id>`, the operation and its id, the text of the marker file that names it (for example the commit being merged).
  - Push: `push`.
- **Names and hashes.** A branch or tag name must match `^[A-Za-z0-9_][A-Za-z0-9._/-]*$`, must not contain `..` or end in `/`, `.` or `.lock` (so it can never start with `-`), and must pass `git check-ref-format refs/heads/<name>` or `refs/tags/<name>` before anything is written. A commit or stash hash must match `^[0-9a-f]{40,64}$`. A message is passed as the value of `-m`, never as a separate option.
- **Captured targets.** The hash, branch name or stash is read when the button is clicked, not later. A stash is applied by its hash. `pop` and `drop` need the entry name, so each first checks that `git rev-parse --verify stash@{n}` still equals the hash that was clicked and refuses otherwise; `branch -d` does the same for `refs/heads/<name>`. A branch name taken from the list goes after `--`, so it can never be read as an option; a new name (rename) passes the same checks as any other.
- **Preconditions.** Nothing here runs while a merge, rebase, cherry-pick, revert or patch is in progress, except Abort. Git's own refusals stay in force (a branch or tag that exists, local changes that would be overwritten, a branch that is not merged); the mod shows git's text. In addition:
  - `branch -d` is offered only for a branch merged into HEAD and never the current one; the mod never uses `-D`.
  - Cherry-pick and revert need a branch checked out (not a detached HEAD), refuse a merge commit (git needs `-m` for it), and re-check right before running that no tracked file has uncommitted changes (`status --porcelain --untracked-files=no` is empty) and that the commit fits HEAD (`merge-base --is-ancestor`: a revert needs it in HEAD's history, a cherry-pick needs it outside). A conflict leaves the operation in progress; the banner then offers Abort, and continuing or finishing is left to a terminal.
  - Abort re-reads which operation is in progress, kind and id, right before it runs and refuses if it is no longer that very one. There is no Abort for a `git am`.
- **Undo.** Every action creates something or can be undone, with one exception: Abort discards the work done on the operation so far (git goes back to the state before it started, but may not be able to rebuild uncommitted changes that existed before it began), which is why it takes two clicks and the banner says so. The success notes of `pop`, `drop` and `branch -d` stay up until clicked away or replaced by the next action's note, and carry the hash and the command that puts it back (`git stash store <hash>`, `git branch <name> <hash>`). A cherry-pick or revert is undone with `git reset` or a revert in a terminal.
- **Reporting.** Status stays plain text in the note bar ([ADR-002](ADR-002-report-status-as-plain-text.md)); the name and message inputs are rows in the commit detail panel and the Refs toolbar, not dialogs.

Never added: `reset`, `clean`, `restore` or `checkout --` (discarding changes), starting a `rebase` or `merge`, `--continue` or `--skip` of an operation, `branch -D`, `stash clear`, deleting remote branches, force push, `--no-verify`, any write to GitHub, and staging or committing (Herdr's Changes panel does that). Other local writes are not in the set above; adding one means updating this ADR and the README Security list first.

## Consequences

- The README Security section lists each of these subcommands, and `check-ref-format`, `rev-parse --verify`, `status --porcelain --untracked-files=no` and `merge-base --is-ancestor` used as preconditions. A new write needs an update to this ADR and to that list.
- `stash push --include-untracked` moves untracked files out of the working tree into the stash; ignored files are left alone. Applying or popping puts them back.
- `stash apply` and `stash pop` can stop on a conflict. Git then keeps the stash and leaves conflict markers. Only the conflicts pill shows it: a stash conflict writes no `MERGE_HEAD`, so there is no in-progress banner and `writeBlock()` does not engage. Git's own refusals (a `switch`, `stash apply`, `stash pop` or `stash push` with an unmerged index) and the harmlessness of creating a ref bound what a click can do next; the user resolves the conflict in a terminal.
- Cherry-pick and revert create a commit, so a commit hook or signing setup (`commit.gpgSign`) can prompt, and a conflict or an empty result leaves the operation in progress. The same goes for a tag with `tag.gpgSign`. Any of these can prompt or hang; `op()` ends such a command after its 120 s timeout and shows the error.
- Known gap, as in ADR-003: between a click and the next refresh the view may still hold the previous state; the checks above and git's refusals bound what a deliberate double click can do.
