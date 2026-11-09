# ADR-001: Keep GitHub access read-only

- Status: Accepted
- Date: 2026-11-09
- Supersedes: none

## Context

The Pull requests tab needs `gh`. The user chose a read-only tab: creating, reviewing and merging pull requests were not requested, and each would be an outward-facing, hard-to-reverse action triggered by a click inside an overlay.

## Decision

The tab only reads PRs (`gh pr list`, `pr view`, `pr diff`) and offers two local-effect actions: `gh pr checkout` and `gh pr view --web`. The `Close` button only dismisses the detail panel; it never runs `gh pr close`.

## Consequences

- The README Security section can list every subcommand and say the mod never changes a PR on GitHub. It must be kept in step with the code (see `AGENTS.md`).
- A reviewer found the docs once claimed `gh pr close`; the label `Close` is easy to misread, so docs say "dismisses the panel".
- Adding any GitHub write needs a new ADR that supersedes this one.
