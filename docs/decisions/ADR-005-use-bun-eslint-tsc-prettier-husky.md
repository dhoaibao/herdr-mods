# ADR-005: Use bun, ESLint, tsc, Prettier and Husky for quality checks

- Status: Accepted
- Date: 2026-11-09
- Supersedes: none

## Context

The mods are plain JavaScript that runs inside Herdr's own runtime (gpui-shell), with no build step and no dependencies. The repo needed automatic quality checks without changing that.

## Decision

Dev tooling only, installed with bun (the user's choice): ESLint (flat config, no environment globals), TypeScript `tsc` in `checkJs` mode against the Herdr-generated `gpui-kit.d.ts` and Prettier (`printWidth` 120), plus the system `shellcheck` binary, run together by `bun run check`; a Husky pre-commit hook runs the same steps. `package.json` and `bun.lock` are never part of an install.

Deliberate settings:

- `noImplicitAny`, `strictNullChecks` and `useUnknownInCatchVariables` are off: the code has no annotations and assigns view state in `init()`, so they would bury real errors.
- ESLint allows `x != null` (lane slots may be null or undefined).
- The hook skips `tsc` and `shellcheck` with a warning when `gpui-kit.d.ts` or `shellcheck` is missing; `bun run check` itself stays strict.
- The hook checks the working tree, not only the index (small repo, no lint-staged).

## Consequences

- The first Prettier run rewrote most of `main.js` and `prs.js`. The formatting itself was verified behavior-preserving (identical syntax trees before and after); the same commit also carries three small lint and type fixes (`const`, an `alpha()` helper, JSDoc types) that review found behavior-preserving.
- `tsc` only works on a machine where Herdr has written `gpui-kit.d.ts` (`herdr-app check git-panel/mods/git-panel`); CI would need that step.
- Type checking is a coarse guard, not a strong one.
