// Constants and tiny helpers shared by the modules of the Git Panel mod.

// Read-only git: no index refresh or lock, so our own folder watch is never triggered by us.
export const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
export const ROW = 28,
  LANE = 16,
  MAX_LANES = 10,
  PAGE = 400;
// The git command that aborts each operation the banner can name (a `git am` has no Abort here).
export const ABORT = { MERGING: "merge", REBASING: "rebase", "CHERRY-PICKING": "cherry-pick", REVERTING: "revert" };

/** Appends an alpha byte to a #rrggbb theme color; the cast satisfies the element API's hex-template type. */
export const alpha = (color, a) => /** @type {`#${string}`} */ (color + a);
