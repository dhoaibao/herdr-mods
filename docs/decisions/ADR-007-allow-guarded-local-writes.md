# ADR-007: Allow Guarded Local Writes

- Status: Accepted
- Date: 2026-11-09
- Supersedes: none (extends [ADR-003](ADR-003-guard-push.md); [ADR-001](ADR-001-keep-github-access-read-only.md) still holds)

## Context

The mod could fetch, pull, push and switch branches. Developers also need to mark a commit (branch or tag), park work in a stash and bring it back, without leaving the overlay. The mod is unsandboxed JavaScript that runs `git`, so each new write has to be limited to what cannot lose work.

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

Rules:

- **Two tiers.** An action that only creates a ref or stash entry, or applies one, takes one click. An action that removes an entry (`pop`) takes two: the first arms it for 5 s with an ansi1 button (`confirm()`, generalizing the Push guard of ADR-003 from a flag to an action key), the second runs it.
- **Names and hashes.** A branch or tag name must match `^[A-Za-z0-9_][A-Za-z0-9._/-]*$`, must not contain `..` or end in `/`, `.` or `.lock` (so it can never start with `-`), and must pass `git check-ref-format refs/heads/<name>` or `refs/tags/<name>` before anything is written. A commit or stash hash must match `^[0-9a-f]{40,64}$`. A message is passed as the value of `-m`, never as a separate option.
- **Captured targets.** The hash, branch name or stash is read when the button is clicked, not later. A stash is applied by its hash. `pop` needs the entry name, so it first checks that `git rev-parse --verify stash@{n}` still equals the hash that was clicked and refuses otherwise.
- **Preconditions.** Nothing here runs while a merge, rebase, cherry-pick, revert or patch is in progress. Git's own refusals stay in force (a branch or tag that exists, local changes that would be overwritten); the mod shows git's text.
- **No data loss.** Every action creates something or can be undone. The success note of a `pop` shows the stash hash and `git stash store <hash>`, which puts the entry back.
- **Reporting.** Status stays plain text in the note bar ([ADR-002](ADR-002-report-status-as-plain-text.md)); the name and message inputs are rows in the commit detail panel and the Refs toolbar, not dialogs.

Never added: `reset`, `clean`, `restore` or `checkout --` (discarding changes), `rebase`, `branch -D`, `stash clear`, deleting remote branches, force push, `--no-verify`, any write to GitHub, and staging or committing (Herdr's Changes panel does that). Other local writes (for example `stash drop`, deleting a merged branch with `-d`, or renaming a branch) are not in the set above; adding one means updating this ADR and the README Security list first.

## Consequences

- The README Security section lists each of these subcommands, and `check-ref-format` and `rev-parse --verify` used as preconditions. A new write needs an update to this ADR and to that list.
- `stash push --include-untracked` moves untracked files out of the working tree into the stash; ignored files are left alone. Applying or popping puts them back.
- `stash apply` and `stash pop` can stop on a conflict. Git then keeps the stash and leaves conflict markers. Only the conflicts pill shows it: a stash conflict writes no `MERGE_HEAD`, so there is no in-progress banner and `writeBlock()` does not engage. Git's own refusals (a `switch`, `stash apply`, `stash pop` or `stash push` with an unmerged index) and the harmlessness of creating a ref bound what a click can do next; the user resolves the conflict in a terminal.
- A commit hook or signing setup (`tag.gpgSign`, `commit.gpgSign` for tags) can prompt or hang; `op()` ends such a command after its 120 s timeout and shows the error.
- Known gap, as in ADR-003: between a click and the next refresh the view may still hold the previous state; the checks above and git's refusals bound what a deliberate double click can do.
