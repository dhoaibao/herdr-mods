// The Pull requests tab of the Git Panel mod, and the chip for the current branch's pull request on
// the Graph tab. Everything here is read from GitHub through the `gh` CLI (list, view, diff); the
// changes are `gh pr checkout` (a local branch switch), opening the PR in the browser, and the guarded
// merge, close, ready-for-review and delete-branch actions of prwrites.js (ADR-009).
// Functions take the GitPanel view as `v` and keep their state on it under the `pr*` names.
import { div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, TextView, v_virtual_list } from "gpui-base";
import { exec } from "herdr";
import { BAR_H, hasActions, prActionBar } from "./prwrites.js";
import { clipDiff } from "./shared.js";

const LIST_FIELDS =
  "number,title,author,headRefName,baseRefName,isDraft,state,updatedAt,reviewDecision,statusCheckRollup,url";
const VIEW_FIELDS =
  "number,title,body,author,reviews,statusCheckRollup,files,url,headRefName,baseRefName,state,isDraft,reviewDecision,additions,deletions,changedFiles,mergeable,mergeStateStatus,labels,reviewRequests,headRefOid,isCrossRepository";
// What the Graph tab's chip needs about the current branch's pull request.
const CHIP_FIELDS = "number,state,isDraft,reviewDecision,statusCheckRollup";
const ROW = 32,
  FRESH_MS = 60000;
export const PR_STATES = [
  ["open", "Open"],
  ["merged", "Merged"],
  ["closed", "Closed"],
];
const PR_STATE_ICON = { open: "pr", merged: "merge", closed: "pr-closed" };
const BAD = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "STARTUP_FAILURE", "ACTION_REQUIRED", "ERROR"]);

export function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  /** @type {[number, string][]} */
  const units = [
    [60, "m"],
    [3600, "h"],
    [86400, "d"],
    [2592000, "mo"],
    [31536000, "y"],
  ];
  for (const [size, unit] of units.reverse()) {
    if (s >= size) return `${Math.floor(s / size)}${unit} ago`;
  }
  return "";
}

// One check or commit status: "pass", "fail", "pending" or "skip".
export function checkState(c) {
  if (c.status && c.status !== "COMPLETED") return "pending";
  if (c.conclusion !== undefined) {
    if (BAD.has(c.conclusion)) return "fail";
    return c.conclusion === "SKIPPED" || c.conclusion === "NEUTRAL" ? "skip" : "pass";
  }
  if (c.state) return BAD.has(c.state) ? "fail" : c.state === "PENDING" || c.state === "EXPECTED" ? "pending" : "pass";
  return "pending";
}

// The whole rollup as one state, or null when the PR has no checks.
export function ciState(rollup) {
  const states = (rollup ?? []).map(checkState).filter((s) => s !== "skip");
  if (!states.length) return null;
  return states.includes("fail") ? "fail" : states.includes("pending") ? "pending" : "pass";
}

// `gh pr diff` prints every file; this cuts it into path -> the lines from the first hunk on.
export function splitDiff(text) {
  const files = new Map();
  let current = null,
    started = false;
  for (const line of text.split("\n")) {
    const head = /^diff --git a\/.+ b\/(.+)$/.exec(line);
    if (head) {
      current = [];
      started = false;
      files.set(head[1], current);
      continue;
    }
    if (!current) continue;
    if (!started && line.startsWith("@@")) started = true;
    if (started) current.push(line);
  }
  return files;
}

export function resetPrs(v) {
  v.prs = [];
  v.prError = null;
  v.prKey = null;
  v.prAt = 0;
  v.prHead = null;
  v.prHeadKey = null;
  v.prHeadAt = 0;
  v.prHeadLoading = false;
  clearPr(v);
}

function clearPr(v) {
  if (/^pr-/.test(v.armed ?? "")) v.armed = null;
  v.prSel = null;
  v.prDetail = null;
  v.prFile = null;
  v.prDiffs = null;
  v.prDiffsFor = null;
  v.setDiff([]);
}

// The pull request of the checked-out branch (`gh pr view` with no number), for the Graph tab's chip.
// GitHub is only asked after the Pull requests tab was opened in this view (`v.prUsed`), as before the
// chip existed, and never when the chip has no room (narrow layout) or the `prChip: false` prop is set.
// Then at most one call a minute for a repo and branch; a branch without a PR, a missing or signed-out
// `gh` or any failure just means no chip.
export function loadCurrentPr(v, cx) {
  if (!v.prChipOn || !v.prUsed || !v.wide || !v.root || !v.branch || v.prHeadLoading) return;
  const context = v.context,
    root = v.root,
    on = v.on,
    branch = v.branch,
    key = `${context}|${branch}`;
  if (v.prHeadKey === key && Date.now() - v.prHeadAt < FRESH_MS) return;
  v.prHeadLoading = true;
  cx.spawn(async (cx) => {
    let changed = false;
    try {
      const r = await exec("gh", ["pr", "view", "--json", CHIP_FIELDS], { cwd: root, on, timeout: 30000 });
      if (v.context !== context) return;
      const p = r.code === 0 ? JSON.parse(r.stdout) : null;
      const next = Number.isInteger(p?.number)
        ? {
            number: p.number,
            state: String(p.state ?? ""),
            isDraft: Boolean(p.isDraft),
            reviewDecision: String(p.reviewDecision ?? ""),
            ci: ciState(p.statusCheckRollup),
            branch,
          }
        : null;
      changed = JSON.stringify(next) !== JSON.stringify(v.prHead);
      v.prHead = next;
    } catch {
      if (v.context === context) {
        changed = v.prHead !== null;
        v.prHead = null;
      }
    } finally {
      // Only for the repo this read was made for: resetPrs already cleared the state of a repo switch.
      if (v.context === context) {
        v.prHeadLoading = false;
        v.prHeadKey = key;
        v.prHeadAt = Date.now();
      }
      if (changed) cx.notify();
    }
  });
}

export function setPrState(v, state, cx) {
  if (v.prState === state) return;
  v.prState = state;
  v.prs = [];
  v.prKey = null;
  clearPr(v);
  loadPrs(v, cx, true);
  cx.notify();
}

export function loadPrs(v, cx, force = false) {
  if (v.prLoading || !v.root) return;
  const state = v.prState,
    context = v.context,
    root = v.root,
    on = v.on,
    key = `${context}|${state}`;
  if (!force && v.prKey === key && Date.now() - v.prAt < FRESH_MS) return;
  v.prLoading = true;
  v.prError = null;
  cx.spawn(async (cx) => {
    try {
      const r = await exec("gh", ["pr", "list", "--state", state, "--limit", "50", "--json", LIST_FIELDS], {
        cwd: root,
        on,
        timeout: 60000,
      });
      if (v.context !== context || v.prState !== state) return;
      if (r.code !== 0)
        throw new Error((r.stderr || r.stdout).trim().split("\n").slice(-3).join("\n") || `gh exited with ${r.code}`);
      v.prs = JSON.parse(r.stdout).map((p) => ({
        ...p,
        ci: ciState(p.statusCheckRollup),
        statusCheckRollup: undefined,
      }));
      v.prKey = key;
      v.prAt = Date.now();
      // A tab opened with props.pr jumps straight to that PR, once.
      if (v.prWant) {
        const n = v.prWant;
        v.prWant = null;
        selectPr(v, n, cx);
      }
    } catch (e) {
      v.prs = [];
      v.prKey = null;
      v.prError = String(e?.message ?? e);
    } finally {
      v.prLoading = false;
      cx.notify();
      if (v.tab === "prs" && (v.prState !== state || v.context !== context)) loadPrs(v, cx);
    }
  });
  cx.notify();
}

export function selectPr(v, number, cx) {
  if (v.prSel === number) {
    clearPr(v);
    cx.notify();
    return;
  }
  clearPr(v);
  v.prSel = number;
  readPr(v, number, cx);
  cx.notify();
}

// Reads one PR's detail into `v.prDetail` (only while it is still the selected one).
function readPr(v, number, cx) {
  const context = v.context,
    root = v.root,
    on = v.on,
    same = () => v.prSel === number && v.context === context;
  cx.spawn(async (cx) => {
    try {
      const r = await exec("gh", ["pr", "view", String(number), "--json", VIEW_FIELDS], {
        cwd: root,
        on,
        timeout: 60000,
      });
      if (!same()) return;
      if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").slice(-3).join("\n"));
      v.prDetail = JSON.parse(r.stdout);
    } catch (e) {
      if (same()) v.prDetail = { error: String(e?.message ?? e) };
    }
    cx.notify();
  });
}

// After a write on GitHub succeeded: drop the freshness windows so the list and the Graph chip are
// read again now, and re-read the open detail without closing it.
function reloadPr(v, cx) {
  v.prKey = null;
  v.prHeadKey = null;
  loadPrs(v, cx, true);
  if (v.prSel !== null) readPr(v, v.prSel, cx);
}

export function pickPrFile(v, path, cx) {
  const number = v.prSel,
    context = v.context,
    root = v.root,
    on = v.on;
  const same = () => v.prSel === number && v.prFile === path && v.context === context;
  v.prFile = path;
  v.setDiff(["Loading…"]);
  cx.spawn(async (cx) => {
    let lines;
    try {
      if (v.prDiffsFor !== number) {
        const r = await exec("gh", ["pr", "diff", String(number), "--color", "never"], {
          cwd: root,
          on,
          timeout: 60000,
        });
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").slice(-2).join("\n"));
        v.prDiffs = splitDiff(r.stdout);
        v.prDiffsFor = number;
      }
      lines = v.prDiffs.get(path);
      if (!lines?.length) lines = ["No text diff (binary file or too large)"];
    } catch (e) {
      lines = [`Cannot show this diff: ${e?.message ?? e}`];
    }
    if (same()) v.setDiff(clipDiff(lines));
    cx.notify();
  });
  cx.notify();
}

// Switches the working tree to the PR's branch; git refuses when local changes are in the way.
export function checkoutPr(v, number, cx) {
  v.op(`Checkout PR #${number}`, ["pr", "checkout", String(number)], cx, "gh");
}

export function openPr(v, number, cx) {
  if (v.on) {
    v.note = { ok: false, text: "Open in browser works only for a repo on this computer" };
    cx.notify();
    return;
  }
  cx.spawn(async (cx) => {
    try {
      const r = await exec("gh", ["pr", "view", String(number), "--web"], { cwd: v.root, timeout: 30000 });
      if (r.code !== 0)
        v.note = {
          ok: false,
          text: (r.stderr || r.stdout).trim().split("\n").slice(-2).join("\n") || "gh could not open the PR",
        };
    } catch (e) {
      v.note = { ok: false, text: `Open in browser failed: ${e?.message ?? e}` };
    }
    cx.notify();
  });
}

// Header controls while this tab shows: which PRs to list, and a reload.
export function prToolbar(v, t) {
  return [
    ...PR_STATES.map(([state, label]) =>
      v.button(`gg-pr-${state}`, label, (cx) => setPrState(v, state, cx), t, {
        tone: v.prState === state ? t.accent : null,
        icon: PR_STATE_ICON[state],
      }),
    ),
    div().flex_1(),
    v.button("gg-pr-reload", "Reload", (cx) => loadPrs(v, cx, true), t, {
      disabled: v.prLoading || !v.root,
      icon: "reload",
    }),
  ];
}

const reviewTone = (t, d) => (d === "APPROVED" ? t.ansi2 : d === "CHANGES_REQUESTED" ? t.ansi1 : t.muted);
const reviewText = (d) =>
  d === "APPROVED"
    ? "approved"
    : d === "CHANGES_REQUESTED"
      ? "changes requested"
      : d === "REVIEW_REQUIRED"
        ? "review required"
        : "";
const ciTone = (t, s) => (s === "fail" ? t.ansi1 : s === "pending" ? t.ansi3 : s === "pass" ? t.ansi2 : t.border);

function chip(text, color, t, max = 160) {
  return div()
    .flex_none()
    .max_w(max)
    .h(20)
    .px(6)
    .flex()
    .items_center()
    .rounded(4)
    .border_1()
    .border_color(color)
    .text_color(color)
    .text_size(12)
    .truncate()
    .child(text);
}

// The Graph tab's chip: the current branch's PR number, state and review decision, with its CI dot.
// A click opens that PR in the Pull requests tab.
export function prChip(v, t) {
  const p = v.prHead;
  const open = p.state === "OPEN";
  const color = p.isDraft ? t.muted : p.state === "MERGED" ? t.ansi5 : p.state === "CLOSED" ? t.ansi1 : t.ansi2;
  const word = p.isDraft ? "Draft" : p.state === "MERGED" ? "Merged" : p.state === "CLOSED" ? "Closed" : "Open";
  const review = open ? reviewText(p.reviewDecision) : "";
  return h_flex()
    .id("gg-pr-chip")
    .flex_none()
    .max_w(280)
    .h(24)
    .px(8)
    .gap(6)
    .items_center()
    .rounded(12)
    .border_1()
    .border_color(color)
    .text_size(12)
    .text_color(color)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => {
      if (v.blocked()) return;
      v.setTab("prs", cx);
      if (v.prSel !== p.number) selectPr(v, p.number, cx);
    })
    .when(Boolean(p.ci), (e) => e.child(div().w(8).h(8).flex_none().rounded(4).bg(ciTone(t, p.ci))))
    .child(
      div()
        .min_w(0)
        .truncate()
        .child(`PR #${p.number} ${word}${review ? ` · ${review}` : ""}`),
    );
}

function prRow(v, p, t) {
  const decision = reviewText(p.reviewDecision);
  return h_flex()
    .w_full()
    .h(ROW)
    .flex_none()
    .px(14)
    .gap(8)
    .items_center()
    .cursor_pointer()
    .when(v.prSel === p.number, (e) => e.bg(t.selected))
    .hover((s) => s.bg(t.hover))
    .child(div().w(8).h(8).flex_none().rounded(4).bg(ciTone(t, p.ci)))
    .child(div().w(52).flex_none().text_color(t.dim).child(`#${p.number}`))
    .when(p.isDraft, (e) => e.child(chip("Draft", t.muted, t, 60)))
    .child(div().flex_1().min_w(0).truncate().child(p.title))
    .child(chip(p.headRefName, t.ansi4, t, 260))
    .when(Boolean(decision), (e) => e.child(chip(decision, reviewTone(t, p.reviewDecision), t, 140)))
    .when(v.wide, (e) =>
      e.child(
        div()
          .w(120)
          .flex_none()
          .truncate()
          .text_size(13)
          .text_color(t.muted)
          .child(p.author?.login ?? ""),
      ),
    )
    .child(div().w(90).flex_none().text_size(13).text_color(t.dim).child(ago(p.updatedAt)));
}

function section(title, t) {
  return div().flex_none().pt(6).text_size(12).text_color(t.dim).font_semibold().child(title.toUpperCase());
}

// Whether an open PR can be merged, as [text, color], or null when GitHub has not worked it out
// (`mergeable` is UNKNOWN for a moment after a push). Both fields are GitHub's own words.
function mergeInfo(d, t) {
  if (d.mergeable === "CONFLICTING" || d.mergeStateStatus === "DIRTY") return ["Has conflicts", t.ansi1];
  switch (d.mergeStateStatus) {
    case "CLEAN":
    case "HAS_HOOKS":
      return ["Ready to merge", t.ansi2];
    case "BEHIND":
      return ["Behind its base branch", t.ansi3];
    case "BLOCKED":
      return ["Blocked: checks or reviews required", t.ansi3];
    case "UNSTABLE":
      return ["Merge allowed, checks failing", t.ansi3];
    default:
      return null;
  }
}

function stateChip(d, t) {
  const merged = d.state === "MERGED",
    closed = d.state === "CLOSED";
  return chip(
    d.isDraft ? "Draft" : merged ? "Merged" : closed ? "Closed" : "Open",
    d.isDraft ? t.muted : merged ? t.ansi5 : closed ? t.ansi1 : t.ansi2,
    t,
    90,
  );
}

// Left column: what the PR is (title, branches, stats), its checks and reviews, and the description.
// Every child is flex_none: in a scrolling column a shrinkable child is squeezed to fit instead of
// scrolling, which is what made wrapped lines overlap.
function infoColumn(v, d, t, mono, h) {
  const checks = (d.statusCheckRollup ?? []).map((c) => ({
    name: c.name ?? c.context ?? "check",
    state: checkState(c),
  }));
  const reviews = (d.reviews ?? []).filter((r) => r.state !== "COMMENTED" || r.body);
  const body = (d.body ?? "").replace(/\r/g, "").trim().slice(0, 8000);
  const decision = reviewText(d.reviewDecision);
  const merge = d.state === "OPEN" ? mergeInfo(d, t) : null;
  const labels = (Array.isArray(d.labels) ? d.labels : []).map((l) => String(l?.name ?? "")).filter(Boolean);
  const requested = (Array.isArray(d.reviewRequests) ? d.reviewRequests : [])
    .map((r) => String(r?.login ?? r?.name ?? r?.slug ?? ""))
    .filter(Boolean);
  return v_flex()
    .id("gg-pr-info")
    .min_w(0)
    .min_h(0)
    .overflow_y_scroll()
    .p(14)
    .when(v.wide, (e) => e.flex_1().h(h))
    .when(!v.wide, (e) => e.w_full().h(h / 2))
    .gap(8)
    .text_size(13)
    .child(div().flex_none().font_semibold().text_size(15).child(d.title))
    .child(
      h_flex()
        .flex_none()
        .gap(8)
        .items_center()
        .flex_wrap()
        .child(stateChip(d, t))
        .child(
          div()
            .flex_none()
            .text_color(t.muted)
            .child(d.author?.login ?? ""),
        )
        .child(div().flex_none().text_color(t.ansi4).font_family(mono).child(d.headRefName))
        .child(div().flex_none().text_color(t.dim).child("→"))
        .child(div().flex_none().text_color(t.muted).font_family(mono).child(d.baseRefName)),
    )
    .child(
      h_flex()
        .flex_none()
        .gap(10)
        .items_center()
        .child(
          div()
            .text_color(t.ansi2)
            .child(`+${d.additions ?? 0}`),
        )
        .child(
          div()
            .text_color(t.ansi1)
            .child(`−${d.deletions ?? 0}`),
        )
        .child(
          div()
            .text_color(t.dim)
            .child(`${d.changedFiles ?? d.files?.length ?? 0} files`),
        )
        .when(Boolean(decision), (e) => e.child(chip(decision, reviewTone(t, d.reviewDecision), t, 160))),
    )
    .when(Boolean(merge) || labels.length > 0, (e) =>
      e.child(
        h_flex()
          .flex_none()
          .gap(6)
          .items_center()
          .flex_wrap()
          .when(Boolean(merge), (e2) => e2.child(chip(merge[0], merge[1], t, 180)))
          .children(labels.slice(0, 8).map((name) => chip(name, t.muted, t, 140)))
          .when(labels.length > 8, (e2) =>
            e2.child(
              div()
                .text_size(12)
                .text_color(t.dim)
                .child(`+${labels.length - 8}`),
            ),
          ),
      ),
    )
    .when(requested.length > 0, (e) =>
      e.child(
        div()
          .flex_none()
          .text_color(t.muted)
          .child(`Review requested: ${requested.join(", ")}`),
      ),
    )
    .when(checks.length > 0, (e) =>
      e.child(section("Checks", t)).children(
        checks.map((c) =>
          h_flex()
            .flex_none()
            .min_h(24)
            .gap(8)
            .items_center()
            .child(
              div()
                .w(8)
                .h(8)
                .flex_none()
                .rounded(4)
                .bg(ciTone(t, c.state === "skip" ? null : c.state)),
            )
            .child(div().flex_1().min_w(0).truncate().child(c.name))
            .child(
              div()
                .flex_none()
                .text_color(c.state === "fail" || c.state === "pending" ? ciTone(t, c.state) : t.dim)
                .child(c.state),
            ),
        ),
      ),
    )
    .when(reviews.length > 0, (e) =>
      e.child(section("Reviews", t)).children(
        reviews.map((r) =>
          h_flex()
            .flex_none()
            .min_h(24)
            .gap(8)
            .items_center()
            .child(
              div()
                .text_color(t.muted)
                .child(r.author?.login ?? ""),
            )
            .child(
              div()
                .text_color(r.state === "APPROVED" ? t.ansi2 : r.state === "CHANGES_REQUESTED" ? t.ansi1 : t.dim)
                .child(r.state.toLowerCase().replace("_", " ")),
            ),
        ),
      ),
    )
    .when(Boolean(body), (e) =>
      e.child(section("Description", t)).child(
        div()
          .flex_none()
          .w_full()
          .child(TextView.markdown(`gg-pr-body-${d.number}`, body).selectable(true)),
      ),
    );
}

// Right column: the changed files; one click opens that file's diff.
function filesColumn(v, d, t, mono, h) {
  const files = d.files ?? [];
  return v_flex()
    .id("gg-pr-files")
    .min_h(0)
    .overflow_y_scroll()
    .p(10)
    .gap(1)
    .text_size(13)
    .when(v.wide, (e) => e.w(440).h(h).flex_none().border_l(1).border_color(t.border))
    .when(!v.wide, (e) =>
      e
        .w_full()
        .h(h / 2)
        .flex_none()
        .border_t(1)
        .border_color(t.border),
    )
    .child(
      div().flex_none().px(6).pb(4).text_size(12).text_color(t.dim).font_semibold().child(`FILES (${files.length})`),
    )
    .children(
      files.map((f) =>
        h_flex()
          .id(`gg-prf-${f.path}`)
          .min_h(28)
          .flex_none()
          .px(6)
          .gap(8)
          .items_center()
          .rounded(6)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => pickPrFile(v, f.path, cx))
          .child(div().flex_1().min_w(0).truncate().font_family(mono).child(f.path))
          .when(f.additions > 0, (e) => e.child(div().flex_none().text_color(t.ansi2).child(`+${f.additions}`)))
          .when(f.deletions > 0, (e) => e.child(div().flex_none().text_color(t.ansi1).child(`−${f.deletions}`))),
      ),
    );
}

// Panel and body sizes are fixed in px: a row whose columns scroll would otherwise size itself to
// its content and spill out of the panel.
const PANEL_H = 440,
  HEAD_H = 40,
  BODY_H = PANEL_H - HEAD_H - 1;

// The body is shorter by the action bar's height when the bar shows, so the panel stays PANEL_H.
function detailBody(v, d, t, mono, h) {
  return (v.wide ? h_flex() : v_flex())
    .w_full()
    .h(h)
    .flex_none()
    .overflow_hidden()
    .child(infoColumn(v, d, t, mono, h))
    .child(filesColumn(v, d, t, mono, h));
}

function detailPanel(v, t, mono) {
  const d = v.prDetail,
    p = v.prs.find((x) => x.number === v.prSel);
  const head = h_flex()
    .h(HEAD_H)
    .flex_none()
    .px(12)
    .gap(8)
    .items_center()
    .border_b(1)
    .border_color(t.border)
    .when(Boolean(v.prFile), (e) =>
      e
        .child(
          v.small(
            "gg-pr-back",
            "Details",
            (cx) => {
              v.prFile = null;
              v.setDiff([]);
              cx.notify();
            },
            t,
            null,
            { icon: "back" },
          ),
        )
        .child(div().flex_1().min_w(0).truncate().font_family(mono).child(v.prFile)),
    )
    .when(!v.prFile, (e) =>
      e
        .child(div().font_family(mono).text_color(t.accent).child(`#${v.prSel}`))
        .child(
          div()
            .flex_1()
            .min_w(0)
            .truncate()
            .child(d?.title ?? p?.title ?? ""),
        )
        .child(
          v.small(
            "gg-pr-checkout",
            "Checkout",
            (cx) => {
              if (!v.busy) checkoutPr(v, v.prSel, cx);
            },
            t,
            null,
            { icon: "checkout" },
          ),
        )
        .when(!v.on, (e2) =>
          e2.child(
            v.small("gg-pr-web", "Open in browser", (cx) => openPr(v, v.prSel, cx), t, null, { icon: "external" }),
          ),
        )
        .child(
          v.small(
            "gg-pr-hide",
            "Hide",
            (cx) => {
              clearPr(v);
              cx.notify();
            },
            t,
            null,
            { icon: "hide" },
          ),
        ),
    );
  const bar = !v.prFile && hasActions(d);
  const body = v.prFile
    ? v.diffView(t, mono)
    : !d
      ? div().p(14).text_color(t.dim).child("Loading…")
      : d.error
        ? div().p(14).text_color(t.ansi1).child(d.error)
        : detailBody(v, d, t, mono, bar ? BODY_H - BAR_H : BODY_H);
  return v_flex()
    .h(PANEL_H)
    .flex_none()
    .overflow_hidden()
    .border_t(1)
    .border_color(t.border)
    .child(head)
    .when(bar, (e) => e.child(prActionBar(v, d, t, (cx) => reloadPr(v, cx))))
    .child(body);
}

export function prPanel(v, t, mono) {
  const empty =
    v.prError ??
    (!v.root ? "Not a git repository" : v.prLoading ? "Loading pull requests…" : `No ${v.prState} pull requests`);
  return v_flex()
    .flex_1()
    .min_h(0)
    .child(
      div()
        .flex_1()
        .min_h(0)
        .relative()
        .child(
          v_virtual_list(
            "gg-prs",
            v.prs.length,
            ROW,
            (i) => String(v.prs[i].number),
            (range) => v.prs.slice(range.start, range.end).map((p) => prRow(v, p, t)),
          )
            .size_full()
            .on_item_click((key, cx) => {
              if (!v.blocked()) selectPr(v, Number(key), cx);
            }),
        )
        .child(Scrollbar.vertical("gg-prs").viewport_from_layout().absolute().inset_0())
        .when(!v.prs.length, (e) => e.child(v.emptyState(empty, v.prError ? t.ansi1 : t.dim, t))),
    )
    .when(v.prSel !== null, (e) => e.child(detailPanel(v, t, mono)));
}
