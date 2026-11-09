# ADR-002: Report operation status as plain text

- Status: Accepted
- Date: 2026-11-09
- Supersedes: none

## Context

Fetch, Pull, Push and checkout take time and can fail. Earlier iterations of the mod tried a spinner on the button and a check-mark after success; the user rejected both and asked to go back to text.

## Decision

Operation state is shown only as text in a note bar under the controls: the running label, `<label>: done` (cleared after 5 s) or the last four lines of git's or gh's own error. Buttons carry icons (SVG files) but never an animated or state-changing glyph.

## Consequences

- Errors from git and gh reach the user verbatim, which is the main diagnostic tool.
- No animation code to maintain.
- A future change to status presentation is a user-visible decision and needs a new ADR.
