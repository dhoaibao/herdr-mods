import { readTextFile } from "herdr";

// Working-tree state for the Graph tab: how many entries `git status` lists, and whether a merge,
// cherry-pick, revert, rebase or `git am` is in progress. Read-only; nothing here writes.

/** Files under the git dir whose existence marks an operation in progress, with what to call it. */
// The order is git's own (wt_status_get_state): a rebase picks commits with CHERRY_PICK_HEAD
// present, so the rebase markers come before it and the first match wins.
const MARKERS = [
  ["MERGE_HEAD", "MERGING"],
  ["rebase-merge/head-name", "REBASING"],
  ["rebase-apply/rebasing", "REBASING"],
  ["rebase-apply/applying", "APPLYING PATCH"],
  ["CHERRY_PICK_HEAD", "CHERRY-PICKING"],
  ["REVERT_HEAD", "REVERTING"],
];

/**
 * Counts the entries of `git status --porcelain=v2 -z --no-renames`: ordinary changes ("1 "),
 * unmerged paths ("u ") and untracked files ("? "). Ignored files are not listed by default.
 * @param {string} text
 * @returns {{ changed: number, conflicts: number }}
 */
export function parseStatus(text) {
  let changed = 0,
    conflicts = 0;
  for (const entry of text.split("\0")) {
    if (entry.startsWith("1 ") || entry.startsWith("? ")) changed++;
    else if (entry.startsWith("u ")) {
      changed++;
      conflicts++;
    }
  }
  return { changed, conflicts };
}

/**
 * The operation in progress, or null. `git` runs a read-only git command in the repo.
 * @param {(args: string[]) => Promise<{ code: number, stdout: string }>} git
 * @param {string} root repo root, used to resolve relative `--git-path` output
 * @param {string | null} on machine the repo lives on
 * @returns {Promise<string | null>}
 */
export async function inProgress(git, root, on) {
  const r = await git(["rev-parse", ...MARKERS.flatMap(([file]) => ["--git-path", file])]);
  if (r.code !== 0) return null;
  const paths = r.stdout.split("\n");
  const found = await Promise.all(
    MARKERS.map(async ([, label], i) => {
      const p = paths[i];
      if (!p) return null;
      // A linked worktree reports absolute paths (`/x` or `C:/x`); the main one reports them relative to the root.
      const text = await readTextFile(/^([A-Za-z]:)?[\\/]/.test(p) ? p : `${root}/${p}`, { on });
      return text === null ? null : label;
    }),
  );
  return found.find(Boolean) ?? null;
}
