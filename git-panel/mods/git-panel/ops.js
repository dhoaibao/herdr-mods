// The one path every git write takes (`op`) and the guards around it: the two-click confirm, the
// in-progress block and the refusal note. Fetch, pull and push are built on it.
import { exec } from "herdr";
import { READ, ABORT } from "./shared.js";

// Runs one git command the user asked for (fetch, pull, push, switch, and the guarded writes of
// ADR-007). One at a time; the outcome shows in the note bar, and the graph reloads afterwards.
// extra.check(run) is a read-only precondition run first (`run(args)` is a READ git call) that
// returns a refusal text or null; extra.ok replaces the success text; extra.done(result) runs on
// success and may replace the note;
// extra.keep leaves the success note up until it is clicked away (it carries a recovery command).
export function op(v, label, args, cx, cmd = "git", extra = {}) {
  if (v.busy || !v.root) return;
  v.busy = label;
  v.note = null;
  v.armed = null;
  const context = v.context,
    root = v.root,
    on = v.on;
  cx.spawn(async (cx) => {
    let ok = false;
    try {
      const refusal = extra.check
        ? await extra.check((a) => exec("git", [...READ, ...a], { cwd: root, on, timeout: 30000 }))
        : null;
      if (v.context !== context) return;
      if (refusal) {
        v.note = { ok: false, text: refusal };
        return;
      }
      const r = await exec(cmd, args, { cwd: root, on, timeout: 120000 });
      if (v.context !== context) return;
      ok = r.code === 0;
      const out = `${r.stderr}\n${r.stdout}`.trim();
      v.note = {
        ok,
        text: ok
          ? (extra.ok ?? `${label}: done`)
          : out.split("\n").slice(-4).join("\n") || `${label} failed (exit ${r.code})`,
      };
      if (ok) extra.done?.(r);
    } catch (e) {
      v.note = { ok: false, text: `${label} failed: ${e}` };
    } finally {
      v.busy = null;
      v.signature = null;
      const mine = v.note;
      // Only a success note times out: `done` may have swapped in a refusal, which stays until replaced.
      if (ok && !extra.keep && v.note?.ok)
        cx.timer.after(5000, (cx) => {
          // Only this operation's own note: a later one (a kept recovery note) must stay.
          if (v.note === mine) {
            v.note = null;
            cx.notify();
          }
        });
      cx.notify();
      v.refresh(cx, true);
    }
  });
  cx.notify();
}

export function fetchAll(v, cx) {
  op(v, "Fetch", ["fetch", "--all", "--prune"], cx);
}

// Fast-forward only: a pull never creates a merge commit or rewrites anything on its own.
export function pull(v, cx) {
  if (!v.branch) {
    v.note = { ok: false, text: "Detached HEAD: switch to a branch to pull" };
    cx.notify();
    return;
  }
  op(v, "Pull", ["pull", "--ff-only"], cx);
}

// Push needs a second click within 5 s, and never forces. A branch without an upstream is
// published to origin and set up to track it.
export function push(v, cx) {
  if (v.busy || !v.root) return;
  if (!v.branch) {
    v.note = { ok: false, text: "Detached HEAD: switch to a branch to push" };
    cx.notify();
    return;
  }
  if (!v.sync && v.upstreamGone) {
    v.note = {
      ok: false,
      text: `Upstream of ${v.branch} no longer exists on the remote. Not re-publishing; run \`git push -u <remote> ${v.branch}\` yourself if you want that.`,
    };
    cx.notify();
    return;
  }
  if (!confirmAction(v, "push", cx)) return;
  op(v, "Push", v.sync ? ["push"] : ["push", "-u", "origin", "HEAD"], cx);
}

// Two-click actions: the first click arms the action for 5 s (its button shows it) and returns
// false; a second click on the same action inside that window returns true.
export function confirmAction(v, key, cx) {
  if (v.busy) return false;
  if (v.armed === key) {
    v.armed = null;
    return true;
  }
  const seq = ++v.armSeq;
  v.armed = key;
  cx.timer.after(5000, (cx) => {
    if (v.armSeq === seq && v.armed === key) {
      v.armed = null;
      cx.notify();
    }
  });
  cx.notify();
  return false;
}

// Why a guarded write must not run now, or null. A merge, rebase, cherry-pick, revert or patch in
// progress would be tangled up with it.
export function writeBlock(v) {
  if (!v.inprog) return null;
  return ABORT[v.inprog]
    ? `${v.inprog}: finish it in a terminal, or use Abort in the banner, first`
    : `${v.inprog}: finish or abort it in a terminal first`;
}

// Shows a refusal in the note bar instead of running anything.
export function refuse(v, text, cx) {
  v.note = { ok: false, text };
  cx.notify();
}
