# Git panel: pull request actions

- Status: approved

## Goal

Let the Pull requests tab merge, close, mark ready for review, and delete the head branch of a pull request, each behind a two-click confirm, without leaving the overlay.

## Requirements

- Decisions confirmed with the user: three-way merge method toggle (default merge, GitHub enforces repository settings); Delete head branch is a separate two-click button after the merge, through `gh api` (remote branch only); Merge is blocked when only non-required checks fail (UNSTABLE); Ready for review takes two clicks; the old dismiss button is renamed `Hide`.
- Policy: [ADR-009](../decisions/ADR-009-allow-guarded-pull-request-writes.md) supersedes ADR-001; the exact commands, preconditions and keys are there.
- A new module `prwrites.js` holds the actions and the action bar; `ops.js` `op()` gains `check(run, gh)` and `done(result, cx)`; `prs.js` renders the bar and re-reads the PR after a write.

## Acceptance criteria

- AC-1: WHEN Merge is clicked twice within 5 s on an open, non-draft, MERGEABLE, CLEAN or HAS_HOOKS PR THEN exactly `gh pr merge <n> --repo <host>/<owner>/<repo> --<method> --match-head-commit <oid>` runs, and the list and detail re-read. Evidence: user-confirmed in the app on a throwaway repo, plus inspection of `prwrites.js`.
- AC-2: WHEN the PR is a draft, conflicting, BLOCKED, BEHIND, UNSTABLE, unknown or not open, or the pre-read shows another head commit, another base branch or another state THEN Merge is disabled or refused with a note and no `pr merge` runs. Evidence: user-confirmed, plus inspection.
- AC-3: WHEN Close PR is clicked twice on an open PR THEN `gh pr close <n> --repo <host>/<owner>/<repo>` runs with no other flag and the kept note names `gh pr reopen <n> --repo <host>/<owner>/<repo>`. Evidence: user-confirmed.
- AC-4: WHEN Delete branch is clicked twice on a merged same-repository PR whose branch still equals the head commit, is not the default branch and is not the base of an open PR THEN `gh api --hostname <host> -X DELETE repos/<o>/<r>/git/refs/heads/<b>` runs, the local branch is untouched, and the kept note says how to restore it. Evidence: user-confirmed, plus `git branch --list <b>` afterwards.
- AC-5: WHEN the PR is from a fork, not merged, or the branch moved, is gone, is the default branch, or is the base of an open PR THEN Delete branch is hidden or refused and no DELETE runs. Evidence: user-confirmed, plus inspection.
- AC-6: WHEN an open PR is a draft THEN Ready for review shows and two clicks run exactly `gh pr ready <n>`; WHEN it is not a draft THEN the button is absent. Evidence: user-confirmed.
- AC-7: WHEN an action is armed and the user selects another PR, hides the panel, changes the state filter or the method, or 5 s pass THEN the arm is dropped, and a single click never runs a write. Evidence: user-confirmed, plus inspection of `clearPr` and the keys.
- AC-8: WHEN `Hide` is clicked THEN the panel closes and no command runs. Evidence: inspection of `prs.js`.
- AC-9: WHEN the source is searched for `--admin`, `--auto`, `--delete-branch`, `--undo` and `--force` THEN none appear in a command. Evidence: automated check, `rg -n -e '--admin' -e '--auto' -e '--delete-branch' -e '--undo' -e '--force' git-panel/mods/git-panel/` printing only comments.
- AC-10: WHEN the docs are read THEN README Security names every `gh` subcommand above, the pre-reads and the `api` GET and DELETE; ADR-009 supersedes ADR-001; ADR-007, AGENTS.md, RECIPE.md and the architecture doc agree. Evidence: inspection against `rg -n 'op\(|exec\(' git-panel/mods/git-panel/*.js`.
- AC-11: WHEN the checks run THEN `herdr-app check git-panel/mods/git-panel` passes and `bun run check` exits 0. Evidence: automated check.

## Out of scope

Creating, reviewing, commenting on or reopening PRs; `--admin`, auto-merge, merge-queue bypass; converting a PR back to a draft; deleting a fork's branch or any local branch; actions on the Graph tab's PR chip.
