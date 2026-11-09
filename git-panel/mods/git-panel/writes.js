// The guarded local writes of the commit detail panel and the banner (ADR-007): branch or tag here,
// cherry-pick, revert, detached checkout and abort. All run through `op` in ops.js.
import { validRefName, NAME_HELP } from "./refs.js";
import { inProgress } from "./status.js";
import { ABORT } from "./shared.js";
import { op, confirmAction, writeBlock, refuse } from "./ops.js";

// The commit the detail panel shows, when it is a row of the graph and a write may run on it.
export function writeTarget(v, cx) {
  const c = v.rows.find((r) => r.c.hash === v.sel)?.c;
  if (!c || !/^[0-9a-f]{40,64}$/.test(c.hash)) return null;
  const block = writeBlock(v);
  if (block) {
    refuse(v, block, cx);
    return null;
  }
  return c;
}

// `git branch <name> <hash>` or `git tag [-a -m <msg>] <name> <hash>`: creates a ref and moves nothing.
// The name is checked here and by `git check-ref-format`; git itself refuses one that exists.
export function createRef(v, kind, cx) {
  const c = writeTarget(v, cx);
  if (!c) return;
  const name = v.refName.value().trim(),
    msg = v.refMsg.value().trim(),
    tag = kind === "tag";
  if (!validRefName(name)) {
    refuse(v, NAME_HELP, cx);
    return;
  }
  const args = tag ? (msg ? ["tag", "-a", name, "-m", msg, c.hash] : ["tag", name, c.hash]) : ["branch", name, c.hash];
  op(v, `${tag ? "Tag" : "Branch"} ${name}`, args, cx, "git", {
    check: async (run) =>
      (await run(["check-ref-format", `${tag ? "refs/tags/" : "refs/heads/"}${name}`])).code === 0
        ? null
        : `"${name}" is not a valid ${tag ? "tag" : "branch"} name`,
    ok: `${tag ? "Tagged" : "Created branch"} ${name} at ${c.short}`,
    done: () => {
      v.refName.set_value("");
      v.refMsg.set_value("");
    },
  });
}

// Cherry-pick or revert the selected commit onto the current branch. Two clicks, because it creates a
// commit; the tracked files must be clean (checked right before it runs), a merge commit is refused
// (git needs -m for it), and a detached HEAD is refused (the new commit would be easy to lose). A
// conflict leaves the operation in progress: the banner offers Abort, and finishing is left to a terminal.
export function pickCommit(v, kind, cx) {
  const c = writeTarget(v, cx);
  if (!c) return;
  const revert = kind === "revert";
  if (c.parents.length > 1)
    return refuse(
      v,
      `A merge commit cannot be ${revert ? "reverted" : "cherry-picked"} here: use a terminal (git needs -m)`,
      cx,
    );
  if (!v.branch) return refuse(v, "Detached HEAD: switch to a branch first", cx);
  if (!confirmAction(v, `${kind}:${c.hash}`, cx)) return;
  op(
    v,
    `${revert ? "Revert" : "Cherry-pick"} ${c.short}`,
    revert ? ["revert", "--no-edit", c.hash] : ["cherry-pick", c.hash],
    cx,
    "git",
    {
      check: async (run) => {
        const r = await run(["status", "--porcelain", "--untracked-files=no"]);
        return r.code === 0 && r.stdout.trim() === ""
          ? null
          : "Tracked files have uncommitted changes: commit or stash them first";
      },
      ok: `${revert ? "Reverted" : "Cherry-picked"} ${c.short} onto ${v.branch}`,
    },
  );
}

// Abort the merge, rebase, cherry-pick or revert in progress (`<op> --abort`). Two clicks, because it
// discards the work done on that operation so far, and only while that operation is still the one in
// progress (re-read right before it runs). This is the one write that is allowed while `inprog` is set.
export function abortOp(v, cx) {
  const kind = v.inprog,
    cmd = ABORT[kind];
  if (!cmd || v.busy || !v.root) return;
  if (!confirmAction(v, `abort:${kind}`, cx)) return;
  const root = v.root,
    on = v.on;
  op(v, `Abort ${cmd}`, [cmd, "--abort"], cx, "git", {
    check: async (run) => ((await inProgress(run, root, on)) === kind ? null : `The ${cmd} is no longer in progress`),
    ok: `Aborted the ${cmd}`,
  });
}

// `git switch --detach <hash>`: git refuses it when local changes would be overwritten.
export function detachHead(v, cx) {
  const c = writeTarget(v, cx);
  if (c) op(v, `Check out ${c.short} (detached)`, ["switch", "--detach", c.hash], cx);
}
