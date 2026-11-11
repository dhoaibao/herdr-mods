# ADR-009: Allow Guarded Pull Request Writes

- Status: Accepted
- Date: 2026-11-11
- Supersedes: [ADR-001](ADR-001-keep-github-access-read-only.md)

## Context

The Pull requests tab was read-only on GitHub ([ADR-001](ADR-001-keep-github-access-read-only.md)). The user now asks for four actions on a pull request without leaving the overlay: merge it, close it, take a draft out of draft, and delete the head branch of a merged one. Each is outward-facing (reviewers are notified, a branch disappears for everyone, a merge cannot be undone), so each takes two clicks and is limited to what the checks below prove still matches what the user clicked.

## Decision

Allowed GitHub writes, all through the view's `op()` (one at a time, argv array with no shell, the context checked, `gh`'s own error text shown, then a refresh of the list and the open detail):

| Action | Command | Clicks | Offered when |
| --- | --- | --- | --- |
| Merge | `gh pr merge <n> --repo <host>/<owner>/<repo> --merge\|--squash\|--rebase --match-head-commit <oid>` | 2 | open, not a draft, `mergeable` MERGEABLE, `mergeStateStatus` CLEAN or HAS_HOOKS |
| Close PR | `gh pr close <n> --repo <host>/<owner>/<repo>` | 2 | open |
| Ready for review | `gh pr ready <n> --repo <host>/<owner>/<repo>` | 2 | open and a draft |
| Delete head branch | `gh api --hostname <host> -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>` | 2 | merged, head in the same repository |

Rules:

- **Two clicks.** The first arms the action for 5 s with an ansi1 button (`Click again to …`), the second runs it (`confirmAction()` of [ADR-007](ADR-007-allow-guarded-local-writes.md)). The key names the whole target, so a click armed on one PR, commit or method never fires on another; selecting another PR, hiding the panel, changing the state filter or the merge method drops a pending arm:
  - Merge: `pr-merge:<host>/<owner>/<repo>#<n>:<base>:<oid>:<method>` (a merge lands on the base branch, so a retargeted PR never fires an armed click)
  - Close PR: `pr-close:<host>/<owner>/<repo>#<n>:<oid>`
  - Ready for review: `pr-ready:<host>/<owner>/<repo>#<n>:<oid>`
  - Delete head branch: `pr-delbranch:<host>/<owner>/<repo>#<n>:<branch>:<oid>`
- **Captured targets.** The repository (`<host>/<owner>/<repo>`, from the PR's URL), the number and the head commit (`headRefOid`, 40 or 64 hex digits) are read from the detail when the button is clicked. Every `gh` read and write about the PR passes that repository as `--repo`: without it `gh` resolves the repository from the checkout's remotes and default, which can change after the PR was listed and would aim a write at the same number in another repository. Right before any write, `gh pr view <n> --repo <host>/<owner>/<repo> --json state,isDraft,mergeable,mergeStateStatus,headRefOid,baseRefName` is read again and the write is refused if the head commit changed, for a merge if the base branch (`baseRefName`) changed, or if the state no longer allows it. Merge also passes `--match-head-commit <oid>`, so GitHub enforces the head commit too. A PR whose URL does not parse gets no action bar.
- **Merge method.** A three-way toggle (merge, squash, rebase; default merge) next to the button. GitHub refuses a method the repository disallows and its text is shown. Merge is disabled, with the reason, for a draft, a conflict, BEHIND, BLOCKED (reviews or checks required), UNSTABLE (non-required checks failing) and an unknown state; it never uses `--admin` or `--auto`. A base branch with a merge queue may queue the PR instead of merging it; the note only says GitHub accepted the request, and the detail shows the state that follows.
- **Delete head branch** removes only the branch on GitHub, never the local one, and is a separate action after the merge (not `--delete-branch`, which also deletes the local branch and would need `-D` after a squash or rebase merge; see ADR-007). It is offered only for a merged PR whose head is in the same repository (`isCrossRepository` false); owner and repository come from the PR's URL, and `--hostname` is the URL's host, so a GitHub Enterprise repository is never sent to github.com. The branch name must pass `validRefName`. Right before the DELETE it reads, and refuses when:
  - the PR is not merged;
  - the branch is the repository's default branch (`gh repo view <host>/<owner>/<repo> --json defaultBranchRef`);
  - an open PR uses the branch as its base (`gh pr list --repo <host>/<owner>/<repo> --base <branch> --state open --limit 1 --json number`);
  - the branch on GitHub is gone (HTTP 404) or no longer points at the PR's head commit (`gh api --hostname <host> repos/<owner>/<repo>/git/ref/heads/<branch> --jq .object.sha`).
  GitHub's own refusal for a protected branch is shown as text. The checked-out branch is not blocked: nothing local changes, the next Fetch (`--prune`) shows the upstream as gone, and [ADR-003](ADR-003-guard-push.md) already stops Push from publishing it again.
- **Undo.** Close is undone with `gh pr reopen <n> --repo <host>/<owner>/<repo>`, a draft by converting it back on GitHub, a deleted branch with the Restore branch button on the PR page; the success notes of Close and Delete stay up until clicked away and say so. A merge has no undo here (GitHub's Revert button on the PR page makes a revert PR).
- **Reporting.** Status stays plain text in the note bar ([ADR-002](ADR-002-report-status-as-plain-text.md)). The existing `Close` button, which only dismisses the detail panel, is renamed `Hide`; the label `Close PR` runs `gh pr close`.

Never added: creating, reviewing, commenting on or reopening a PR, `--admin`, `--auto`, `--delete-branch`, converting a PR back to a draft, deleting a branch of a fork or any local branch through `gh`, deleting any remote branch except through the action above, and any other write to GitHub. Adding one means updating this ADR and the README Security list first. [ADR-003](ADR-003-guard-push.md) (Push) and the local writes of ADR-007 are unchanged.

## Consequences

- The README Security section lists every `gh` subcommand above, the pre-reads, and the `api` GET and DELETE of a ref, and no longer says the mod never merges or closes a PR.
- Known gap, as in ADR-003 and ADR-007: between a click and the next reload the view may hold the previous state, and a list reload already in flight when a write succeeds can land with the old state until the next Reload; the pre-read, `--match-head-commit` and GitHub's own refusals bound what a deliberate double click can do.
- Known gap, Delete head branch: GitHub's ref delete (REST `DELETE git/refs/…`, and GraphQL `deleteRef`) takes no expected commit, so a push to the branch between the last check (the ref read) and the DELETE cannot be detected; the branch ref is removed but the pushed commits stay in the repository, and GitHub's own Delete branch button has the same window. The success note says the branch was at that commit "when checked". Another pre-read cannot close this; the only way to remove the gap is to drop the action.
- Known gap, other PR-by-number calls: `gh pr checkout` and `gh pr view --web` (read-only or local) still resolve the repository from the checkout; they predate this ADR and do not write to GitHub.
- `--match-head-commit` is documented for current `gh`; if an older `gh` does not know it, the merge fails with `gh`'s "unknown flag" text and nothing is merged.
- A merge needs `gh` to be signed in with write access; otherwise `gh`'s error is shown.
