# ADR-010: Allow Force-Deleting Local Branches

- Status: Accepted
- Date: 2026-11-16
- Supersedes: [ADR-007](ADR-007-allow-guarded-local-writes.md) in part (its rule that the mod never uses `git branch -D`; everything else in ADR-007 stands)

## Context

[ADR-007](ADR-007-allow-guarded-local-writes.md) first allowed only `git branch -d` and listed `-D` as never added. Two cases showed that this leaves branches the user cannot tidy from the overlay:

- A branch whose commits are not reachable from HEAD, for example one that was squash-merged on GitHub. `-d` refuses it, and `-D` is the only way git deletes it. Commit 49e1182 added `-D` for this case and edited ADR-007 in place, which this ADR now records properly.
- A branch that is merged into HEAD but ahead of its upstream. `git branch -d` compares the branch with its upstream when it has one (HEAD only when it has none), so it refuses a branch that has commits its upstream lacks, even when HEAD already contains them. The mod used `-d` for every branch reachable from HEAD, so this branch could not be deleted at all (found by an audit of the repository on 2026-11-15).

## Decision

The mod may run `git branch -D -- <name>` as well as `git branch -d -- <name>`, both through `op()` and both with two clicks:

| Branch | Command | Button |
| --- | --- | --- |
| merged into HEAD, not ahead of its upstream (or no upstream, or upstream gone) | `git branch -d -- <name>` | `Delete (merged)` |
| merged into HEAD, ahead of its upstream | `git branch -D -- <name>` | `Delete (merged)` |
| not merged into HEAD | `git branch -D -- <name>` | `Delete (unmerged)` |

Rules, in addition to those of ADR-007 (two clicks, targets captured at click time, the branch name after `--`, never the current branch, nothing while an operation is in progress):

- **Own arm key.** Every `-D` delete uses `del:<hash>:<name>:force`; a `-d` delete uses `del:<hash>:<name>`. An arm for one command never lets a single click run the other.
- **Still where it was.** Right before running, `git rev-parse --verify --quiet refs/heads/<name>` must still equal the hash the list showed (as for `-d`).
- **Still merged.** For a merged branch deleted with `-D` (ahead of its upstream), `git merge-base --is-ancestor <hash> HEAD` must also still succeed right before running. Otherwise HEAD moved since the list was read and the branch is no longer the merged one the user clicked; the delete is refused and the list reloads.
- **Undo.** The success note stays up until clicked away and carries the hash and `git branch <name> <hash>`. For an unmerged branch the hash is the only record of its commits (they stay reachable through the reflog until git prunes them); for a merged one the commits are also in HEAD.

Never added, unchanged: deleting a remote branch with git, and `-D` for the current branch.

## Consequences

- The README Security section lists `branch -D` next to `branch -d` and `merge-base --is-ancestor` among the preconditions (already listed for cherry-pick and revert).
- ADR-007's table, key list and Preconditions bullet name this ADR for which command runs; its Status points here, and the `-d`/`-D` rule is refined by this ADR.
- A merged branch that is ahead of its upstream loses nothing when deleted: its commits are in HEAD. It is still marked `Delete (merged)`.
- Known gap, as in ADR-007: the list is read before the click, so the pre-checks above bound what a deliberate double click can do.
