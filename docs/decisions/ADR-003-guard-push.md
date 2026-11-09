# ADR-003: Guard Push

- Status: Accepted
- Date: 2026-11-09
- Supersedes: none

## Context

Push is the only git action that changes a remote. A stray click should not publish work, and a branch whose remote was deleted after a merge (and pruned by the mod's own Fetch) must not come back.

## Decision

- Push needs two clicks: the first arms it (`Click again to push`, an ansi1 border) for 5 s.
- It never forces.
- A branch that never had an upstream runs `push -u origin HEAD`; an existing upstream runs a plain `push`.
- A branch with an upstream configured (`branch.<name>.merge`) whose remote-tracking ref is gone is refused with a note; the user can push by hand.
- A detached HEAD cannot push.

## Consequences

- `refresh()` has to read `branch.<name>.merge` when there is no usable upstream, and must assign `branch`, `sync` and `upstreamGone` together so the guard never sees a mixed state (found in review).
- Known gap: right after a switch, before the next refresh finishes, the previous branch's state is still held; a deliberate double click inside that window could take the wrong path. Accepted, not widened.
