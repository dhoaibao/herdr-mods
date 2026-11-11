// The guarded GitHub writes of the pull request detail panel (ADR-009): merge, close, ready for
// review and delete the head branch of a merged PR. All run through `op` in ops.js with the `gh` CLI,
// two clicks each, after a fresh read of the PR that must still match what was clicked. Never the
// admin, auto-merge or delete-branch flags of `gh pr merge`, and never a local branch.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { validRefName } from "./refs.js";
import { op, confirmAction, refuse } from "./ops.js";

export const BAR_H = 44;
export const METHODS = ["merge", "squash", "rebase"];
const OID = /^[0-9a-f]{40,64}$/;
// Same-repository PR URL: https://<host>/<owner>/<repo>/pull/<n> (no URL global in a mod, see README).
const PR_URL = /^https:\/\/([A-Za-z0-9.-]+)\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/\d+/;
const tail = (r, n = 2) => (r.stderr || r.stdout).trim().split("\n").slice(-n).join("\n");
const clip = (s, n = 36) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const methodOf = (v) => (METHODS.includes(v.prMethod) ? v.prMethod : "merge");
// The keys name the repository too (`<host>/<owner>/<repo>`), so a click armed for a PR never fires on
// the same number in another repository.
// A merge lands on the base branch, so its key names that too: a retarget re-arms instead of merging.
export const mergeKey = (d, method) => `pr-merge:${slugOf(d)}#${d.number}:${d.baseRefName}:${d.headRefOid}:${method}`;
export const closeKey = (d) => `pr-close:${slugOf(d)}#${d.number}:${d.headRefOid}`;
export const readyKey = (d) => `pr-ready:${slugOf(d)}#${d.number}:${d.headRefOid}`;
export const delKey = (d) => `pr-delbranch:${slugOf(d)}#${d.number}:${d.headRefName}:${d.headRefOid}`;

// Host, owner and repository of a PR, from its URL (a PR of this repository, so also its head's).
function prRepo(d) {
  const m = PR_URL.exec(String(d?.url ?? ""));
  return m ? { host: m[1], owner: m[2], repo: m[3] } : null;
}

// `<host>/<owner>/<repo>` of the PR as displayed. Every read and write below passes it as `--repo`:
// without it `gh` picks the repository from the checkout's remotes and default, which can change
// after the PR was listed and would point a write at the same number in another repository.
function slugOf(d) {
  const t = prRepo(d);
  return t ? `${t.host}/${t.owner}/${t.repo}` : "";
}

// The head branch can be deleted only after the merge, and only when it lives in the same repository.
const canDelete = (d) => d.state === "MERGED" && d.isCrossRepository === false && validRefName(String(d.headRefName));

// Whether the action bar has anything to show for this detail.
export function hasActions(d) {
  return Boolean(d) && !d.error && Boolean(prRepo(d)) && (d.state === "OPEN" || canDelete(d));
}

// Why an open PR cannot be merged right now (GitHub's own `mergeable` and `mergeStateStatus`), or null.
export function mergeBlock(p) {
  if (p.state !== "OPEN") return "The pull request is no longer open";
  if (p.isDraft) return "Draft: mark it ready for review first";
  if (p.mergeable === "CONFLICTING" || p.mergeStateStatus === "DIRTY") return "Has conflicts";
  switch (p.mergeStateStatus) {
    case "CLEAN":
    case "HAS_HOOKS":
      return p.mergeable === "MERGEABLE" ? null : "GitHub is still checking: reload in a moment";
    case "BEHIND":
      return "Behind its base branch";
    case "BLOCKED":
      return "Blocked: checks or reviews required";
    case "UNSTABLE":
      return "Checks are failing";
    default:
      return "GitHub is still checking: reload in a moment";
  }
}

// The PR as it is now, and refused when its head commit is no longer the one that was clicked or,
// when `base` is given (a merge), when it now targets another base branch.
async function reread(gh, slug, n, oid, base) {
  const r = await gh([
    "pr",
    "view",
    String(n),
    "--repo",
    slug,
    "--json",
    "state,isDraft,mergeable,mergeStateStatus,headRefOid,baseRefName",
  ]);
  if (r.code !== 0) return [null, `Could not re-read #${n}: ${tail(r)}`];
  let p;
  try {
    p = JSON.parse(r.stdout);
  } catch {
    return [null, `Could not re-read #${n}`];
  }
  if (p.headRefOid !== oid) return [null, `#${n} has a new commit since you clicked: review it, then click again`];
  if (base !== undefined && p.baseRefName !== base)
    return [null, `#${n} now targets ${p.baseRefName}, not ${base}: review it, then click again`];
  return [p, null];
}

// The detail the buttons act on, read when clicked; refuses what cannot be acted on safely.
function target(v, cx) {
  const d = v.prDetail;
  // blocked(): the branch menu may be over the button, and a click-through must not reach a write.
  if (v.blocked() || v.busy || !v.root || !d || d.error || d.number !== v.prSel) return null;
  if (!Number.isSafeInteger(d.number) || d.number <= 0 || !OID.test(String(d.headRefOid)) || !prRepo(d)) {
    refuse(v, "Cannot read this pull request's repository or head commit: reload it first", cx);
    return null;
  }
  return d;
}

// `after(cx)` reloads the list and the open detail once a write succeeded (prs.js).
export function mergePr(v, cx, after) {
  const d = target(v, cx);
  if (!d) return;
  const n = d.number,
    oid = d.headRefOid,
    slug = slugOf(d),
    base = String(d.baseRefName ?? ""),
    method = methodOf(v);
  if (!base) return refuse(v, "Cannot read this pull request's base branch: reload it first", cx);
  const why = mergeBlock(d);
  if (why) return refuse(v, why, cx);
  if (!confirmAction(v, mergeKey(d, method), cx)) return;
  op(
    v,
    `Merge #${n}`,
    ["pr", "merge", String(n), "--repo", slug, `--${method}`, "--match-head-commit", oid],
    cx,
    "gh",
    {
      check: async (_run, gh) => {
        const [p, err] = await reread(gh, slug, n, oid, base);
        return err ?? mergeBlock(p);
      },
      ok: `GitHub accepted the ${method} of #${n}; the panel shows the result`,
      done: (_r, cx2) => after(cx2),
    },
  );
}

export function closePr(v, cx, after) {
  const d = target(v, cx);
  if (!d) return;
  const n = d.number,
    oid = d.headRefOid,
    slug = slugOf(d);
  if (d.state !== "OPEN") return refuse(v, "The pull request is no longer open", cx);
  if (!confirmAction(v, closeKey(d), cx)) return;
  op(v, `Close #${n}`, ["pr", "close", String(n), "--repo", slug], cx, "gh", {
    check: async (_run, gh) => {
      const [p, err] = await reread(gh, slug, n, oid);
      return err ?? (p.state === "OPEN" ? null : "The pull request is no longer open");
    },
    ok: `Closed #${n}. To undo: gh pr reopen ${n} --repo ${slug}`,
    keep: true,
    done: (_r, cx2) => after(cx2),
  });
}

export function readyPr(v, cx, after) {
  const d = target(v, cx);
  if (!d) return;
  const n = d.number,
    oid = d.headRefOid,
    slug = slugOf(d);
  if (d.state !== "OPEN" || !d.isDraft) return refuse(v, "Only an open draft can be marked ready", cx);
  if (!confirmAction(v, readyKey(d), cx)) return;
  op(v, `Ready #${n}`, ["pr", "ready", String(n), "--repo", slug], cx, "gh", {
    check: async (_run, gh) => {
      const [p, err] = await reread(gh, slug, n, oid);
      return err ?? (p.state === "OPEN" && p.isDraft ? null : "It is no longer an open draft");
    },
    ok: `#${n} is ready for review (reviewers were notified). To undo: convert it to draft on GitHub`,
    keep: true,
    done: (_r, cx2) => after(cx2),
  });
}

// Deletes the head branch on GitHub only (`DELETE git/refs/heads/<branch>`), never the local one.
export function deleteHeadBranch(v, cx, after) {
  const d = target(v, cx);
  if (!d) return;
  if (!canDelete(d))
    return refuse(v, "Only the branch of a merged pull request from this repository can be deleted", cx);
  const n = d.number,
    oid = d.headRefOid,
    branch = d.headRefName,
    { host, owner, repo } = prRepo(d),
    slug = slugOf(d);
  if (!confirmAction(v, delKey(d), cx)) return;
  op(
    v,
    `Delete ${branch}`,
    ["api", "--hostname", host, "-X", "DELETE", `repos/${owner}/${repo}/git/refs/heads/${branch}`],
    cx,
    "gh",
    {
      check: async (_run, gh) => {
        const [p, err] = await reread(gh, slug, n, oid);
        if (err) return err;
        if (p.state !== "MERGED") return "The pull request is not merged";
        const def = await gh(["repo", "view", slug, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"]);
        if (def.code !== 0) return `Could not read the default branch: ${tail(def)}`;
        if (def.stdout.trim() === branch) return `${branch} is the default branch: not deleting it`;
        const bases = await gh([
          "pr",
          "list",
          "--repo",
          slug,
          "--base",
          branch,
          "--state",
          "open",
          "--limit",
          "1",
          "--json",
          "number",
        ]);
        if (bases.code !== 0) return `Could not check the open pull requests on ${branch}: ${tail(bases)}`;
        let open;
        try {
          open = JSON.parse(bases.stdout);
        } catch {
          return `Could not check the open pull requests on ${branch}`;
        }
        if (!Array.isArray(open) || open.length)
          return `${branch} is the base of an open pull request: not deleting it`;
        const ref = await gh([
          "api",
          "--hostname",
          host,
          `repos/${owner}/${repo}/git/ref/heads/${branch}`,
          "--jq",
          ".object.sha",
        ]);
        if (ref.code !== 0)
          return /404|Not Found/i.test(`${ref.stderr}\n${ref.stdout}`)
            ? `${branch} is already deleted`
            : `Could not read ${branch}: ${tail(ref)}`;
        return ref.stdout.trim() === oid ? null : `${branch} moved since the merge: not deleting it`;
      },
      // GitHub's ref delete takes no expected commit, so a push between the last check and the DELETE
      // cannot be detected (ADR-009 known gap): the note says where the branch was when it was checked.
      ok: `Deleted ${branch} on GitHub (at ${oid.slice(0, 7)} when checked). To undo: Restore branch on the pull request page`,
      keep: true,
      done: (_r, cx2) => after(cx2),
    },
  );
}

// The row under the detail header: the merge method and Merge (open, not a draft), Ready for review
// (a draft), Close PR (open) and Delete branch (merged). A button armed for its second click turns
// ansi1 and says what the click will do.
export function prActionBar(v, d, t, after) {
  const open = d.state === "OPEN",
    method = methodOf(v),
    block = open && !d.isDraft ? mergeBlock(d) : null;
  const act = (id, text, key, armedText, fn, icon) =>
    v.small(id, v.armed === key ? armedText : text, fn, t, v.armed === key ? t.ansi1 : null, { icon });
  const kids = [];
  if (open && !d.isDraft) {
    kids.push(div().flex_none().text_size(12).text_color(t.dim).child("Method"));
    for (const m of METHODS)
      kids.push(
        v.small(
          `gg-pr-m-${m}`,
          m,
          (cx) => {
            if (v.blocked()) return;
            v.prMethod = m;
            if (/^pr-merge:/.test(v.armed ?? "")) v.armed = null;
            cx.notify();
          },
          t,
          m === method ? t.accent : null,
        ),
      );
    kids.push(
      block
        ? v.small("gg-pr-merge", "Merge", () => {}, t, null, { icon: "merge", disabled: true })
        : act(
            "gg-pr-merge",
            "Merge",
            mergeKey(d, method),
            `Click again to merge #${d.number} (${method})`,
            (cx) => mergePr(v, cx, after),
            "merge",
          ),
    );
  }
  kids.push(
    div()
      .flex_1()
      .min_w(0)
      .truncate()
      .text_size(12)
      .text_color(t.dim)
      .child(block ?? ""),
  );
  if (open && d.isDraft)
    kids.push(
      act(
        "gg-pr-ready",
        "Ready for review",
        readyKey(d),
        `Click again to mark #${d.number} ready`,
        (cx) => readyPr(v, cx, after),
        "ready",
      ),
    );
  if (open)
    kids.push(
      act(
        "gg-pr-closepr",
        "Close PR",
        closeKey(d),
        `Click again to close #${d.number}`,
        (cx) => closePr(v, cx, after),
        "pr-closed",
      ),
    );
  if (canDelete(d))
    kids.push(
      act(
        "gg-pr-delbranch",
        "Delete branch",
        delKey(d),
        `Click again to delete ${clip(d.headRefName)}`,
        (cx) => deleteHeadBranch(v, cx, after),
        "trash",
      ),
    );
  return h_flex()
    .h(BAR_H)
    .flex_none()
    .px(12)
    .gap(8)
    .items_center()
    .overflow_hidden()
    .border_b(1)
    .border_color(t.border)
    .children(kids);
}
