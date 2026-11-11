import { View } from "gpui-kit";
import { InputState, VirtualListScrollHandle } from "gpui-base";
import { spaces, panes, focused, exec, watchFolder, props } from "herdr";
import { loadPrs, loadCurrentPr, resetPrs } from "./prs.js";
import { initConfig, loadConfig, resetConfig } from "./config.js";
import { initRefs, loadRefs, resetRefs } from "./refs.js";
import { parseStatus, inProgress } from "./status.js";
import { READ, PAGE } from "./shared.js";
import { FORMAT, parseLog, layout } from "./log.js";
import { button, small, field, pill, emptyState } from "./ui.js";
import { op, confirmAction, writeBlock, refuse } from "./ops.js";
import { hits, goHit, nextHit } from "./search.js";
import { clearSel, selectCommit, jumpTo, detailPanel } from "./detail.js";
import { setDiff, diffView } from "./diff.js";
import { renderPanel } from "./render.js";

// Where the focused terminal is (same rule as the shipped Changes panel).
function location() {
  const space = spaces().find((s) => s.active),
    f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on =
    f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : (space?.machine ?? null);
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}

// The last graph read for each folder. Module code outlives a closed overlay, so reopening the
// mod paints the previous graph at once and refreshes it in the background.
const CACHE = new Map();
const TABS = ["graph", "refs", "prs", "config"];
let LAST_TAB = "graph"; // reopening the mod returns to the tab it was closed on
const CACHED = [
  "root",
  "on",
  "rows",
  "lanes",
  "more",
  "branch",
  "sync",
  "upstreamGone",
  "work",
  "inprog",
  "inprogId",
  "signature",
  "limit",
];

// Stores the view's last good read of a folder in CACHE (the newest eight folders are kept).
function remember(v, context) {
  CACHE.delete(context);
  CACHE.set(context, Object.fromEntries(CACHED.map((k) => [k, v[k]])));
  if (CACHE.size > 8) CACHE.delete(CACHE.keys().next().value);
}

export default class GitPanel extends View {
  init(_props, cx) {
    this.folder = typeof props()?.folder === "string" ? props().folder : null;
    this.rows = [];
    this.lanes = 1;
    this.limit = PAGE;
    this.more = false;
    this.sel = null;
    this.detail = null;
    this.files = [];
    this.openFile = null;
    /** @type {{ path: string, rows: object[], loading: boolean, error: string | null } | null} the open file's history, in place of its diff */
    this.fileHist = null;
    this.diff = [];
    this.diffWidth = 300;
    this.wide = true;
    this.roomy = true; // room for the search box in the controls row
    /** @type {string} the theme's mono font, set on each render for the row renderers */
    this.mono = "JetBrains Mono";
    this.branch = null;
    this.sync = null;
    /** @type {{ changed: number, conflicts: number } | null} files that differ from HEAD */
    this.work = null;
    /** @type {string | null} merge, cherry-pick, revert or rebase in progress */
    this.inprog = null;
    /** @type {string} identifies the operation in `inprog` (see status.js), part of the Abort key */
    this.inprogId = "";
    /** @type {{ email: string, committer: string, committerEmail: string } | null} extra fields of the selected commit */
    this.meta = null;
    this.scroll = VirtualListScrollHandle.new();
    this.busy = null;
    this.note = null;
    /** @type {string | null} the two-click action waiting for its second click */
    this.armed = null;
    this.armSeq = 0;
    this.menu = false;
    this.guard = 0;
    this.branches = [];
    this.filter = "";
    this.tab = TABS.includes(props()?.tab) ? props().tab : LAST_TAB;
    // The PR chip asks GitHub only after the Pull requests tab was used in this view (see loadCurrentPr).
    this.prUsed = this.tab === "prs";
    this.prState = ["open", "merged", "closed"].includes(props()?.state) ? props().state : "open";
    this.prLoading = false;
    // {"prChip": false} turns the current branch's PR chip off for good (a mod.open overlay cannot pass props, which is why the chip also waits for the PR tab, see prUsed).
    this.prChipOn = ![false, "false"].includes(props()?.prChip);
    /** @type {{ number: number, title: string, state: string, isDraft: boolean, reviewDecision: string, ci: string | null, branch: string } | null} the current branch's PR (see prs.js) */
    this.prHead = null;
    resetPrs(this);
    initConfig(this);
    initRefs(this);
    const raw = props()?.pr,
      want = typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw)) ? Number(raw) : NaN;
    this.prWant = Number.isSafeInteger(want) && want > 0 ? want : null;
    this.input = InputState.new({ placeholder: "Find or create a branch" });
    this.input.on("change", (_e, cx) => {
      this.filter = this.input.value().trim();
      cx.notify();
    });
    // Search: matches among the loaded rows are found by hits() (memoized on the rows and the text).
    // Typing jumps to the first match; Enter and Shift+Enter step through them.
    this.search = "";
    /** @type {string | null} hash of the match the list was last moved to */
    this.curHit = null;
    this.hitRows = null;
    this.hitQuery = null;
    /** @type {number[]} row indexes of the matches */
    this.hitList = [];
    /** @type {Set<string>} hashes of the matches */
    this.hitSet = new Set();
    this.searchInput = InputState.new({ placeholder: "Search commits" });
    this.searchInput.on("change", (_e, cx) => {
      const search = this.searchInput.value().trim().toLowerCase();
      // A trailing space (or any edit that leaves the text as it was) must not throw away the match
      // the user stepped to.
      if (search === this.search) return;
      this.search = search;
      this.curHit = null;
      hits(this);
      if (this.hitList.length) goHit(this, 0, cx);
      else cx.notify();
    });
    this.searchInput.on("submit", (e, cx) => nextHit(this, e.shift ? -1 : 1, cx));
    // Name and optional message for "Branch here" / "Tag here" in the commit detail panel.
    this.refName = InputState.new({ placeholder: "Branch or tag name" });
    this.refMsg = InputState.new({ placeholder: "Tag message (optional)" });
    const context = this.ctx(),
      hit = CACHE.get(context);
    if (hit) {
      this.context = context;
      for (const k of CACHED) this[k] = hit[k];
    }
    this.refresh(cx);
    cx.timer.every(5000, (cx) => this.refresh(cx));
  }

  // props().folder pins the graph to one folder (a pane or tab opened for a repo); otherwise it follows the focused terminal.
  where() {
    return this.folder ? { cwd: this.folder, on: null } : location();
  }

  ctx() {
    return JSON.stringify(this.where());
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch {
        this.watched = null;
      }
    });
  }

  refresh(cx, force = false) {
    if (this.loading) return;
    const { cwd, on } = this.where(),
      context = this.ctx();
    if (context !== this.context) {
      this.context = context;
      this.root = null;
      this.rows = [];
      this.clearSel();
      this.error = null;
      this.signature = null;
      this.watched = null;
      this.limit = PAGE;
      this.more = false;
      this.branch = null;
      this.sync = null;
      this.work = null;
      this.inprog = null;
      this.inprogId = "";
      this.menu = false;
      this.note = null;
      this.armed = null;
      resetPrs(this);
      resetConfig(this);
      resetRefs(this);
      force = true;
    }
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      let changed = force;
      try {
        // The repo root is known after the first read, so later refreshes skip that process.
        const top =
          this.root && this.context === context
            ? { code: 0, stdout: this.root }
            : await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (this.ctx() !== context) return;
        if (top.code !== 0) {
          this.root = null;
          this.rows = [];
          this.error = "Not a git repository";
          changed = true;
          return;
        }
        const root = top.stdout.trim(),
          git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const [refs, head, sym, ab, st, info] = await Promise.all([
          git(["for-each-ref", "--format=%(objectname) %(refname)"]),
          git(["rev-parse", "HEAD"]),
          git(["symbolic-ref", "--short", "-q", "HEAD"]),
          git(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]),
          // Like the probe below, a failed status only hides the pill, never the graph.
          git(["status", "--porcelain=v2", "-z", "--no-renames"]).catch(() => ({ code: 1, stdout: "", stderr: "" })),
          // A failure here only hides the banner; it never stops the graph from loading.
          inProgress(git, root, on).catch(() => null),
        ]);
        if (this.ctx() !== context) return;
        const work = st.code === 0 ? parseStatus(st.stdout) : null;
        const prog = info?.label ?? null,
          progId = info?.id ?? "";
        const progChanged = prog !== this.inprog || progId !== this.inprogId;
        if (work?.changed !== this.work?.changed || work?.conflicts !== this.work?.conflicts || progChanged)
          changed = true;
        this.work = work;
        // An armed Abort belongs to the operation the banner showed; when it ends or another one
        // starts (even of the same kind), the arm goes with it.
        if (progChanged && this.armed?.startsWith("abort:")) this.armed = null;
        this.inprog = prog;
        this.inprogId = progId;
        const counts = ab.code === 0 ? ab.stdout.trim().split(/\s+/).map(Number) : null;
        const signature = `${refs.stdout}|${head.stdout}|${sym.stdout}|${counts}|${this.limit}`;
        const branch = sym.code === 0 ? sym.stdout.trim() : null;
        // No usable upstream is either "never set" or "set, but its remote-tracking ref is gone"
        // (e.g. deleted after a merge and pruned). Push must not silently re-publish in the latter case.
        // Resolved before anything is assigned, so branch, sync and upstreamGone change together.
        let gone = false;
        if (!counts && branch) {
          const cfg = await git(["config", "--get", `branch.${branch}.merge`]);
          if (this.ctx() !== context) return;
          gone = cfg.code === 0 && cfg.stdout.trim() !== "";
        }
        this.root = root;
        this.on = on;
        // Behind/ahead of the upstream; null when the branch has none (or HEAD is detached).
        this.branch = branch;
        this.sync = counts ? { behind: counts[0], ahead: counts[1] } : null;
        this.upstreamGone = gone;
        this.watch(root, cx);
        // An error from the last read is retried even when the refs did not change.
        if (!force && signature === this.signature && !this.error) {
          // The graph is unchanged, but the pills (changed files, ahead/behind) are not part of the
          // signature: keep the remembered copy current, so a reopened overlay never paints old ones.
          remember(this, context);
          return;
        }
        const log = await git([
          "log",
          "--branches",
          "--remotes",
          "--tags",
          "HEAD",
          "--date-order",
          "-n",
          String(this.limit),
          `--format=${FORMAT}`,
        ]);
        if (this.ctx() !== context) return;
        if (log.code !== 0) {
          const error = log.stderr.trim() || "No commits yet";
          // The same failure again (it is retried on every refresh) is not worth a repaint.
          if (error !== this.error || this.rows.length) changed = true;
          this.rows = [];
          this.error = error;
          this.signature = signature;
          return;
        }
        const commits = parseLog(log.stdout);
        const l = layout(commits);
        this.rows = l.rows;
        this.lanes = l.lanes;
        this.more = commits.length >= this.limit;
        this.error = null;
        this.signature = signature;
        changed = true;
        remember(this, context);
        // On the Refs tab the open commit is a stash, which the graph log never lists.
        if (this.sel && this.tab !== "refs" && !commits.some((c) => c.hash === this.sel)) this.clearSel();
      } catch (e) {
        if (this.ctx() === context) {
          this.error = String(e);
          changed = true;
        }
      } finally {
        this.loading = false;
        if (changed) cx.notify();
        if (this.tab === "prs") loadPrs(this, cx);
        if (this.tab === "config") loadConfig(this, cx);
        if (this.tab === "refs") loadRefs(this, cx);
        if (this.tab === "graph") loadCurrentPr(this, cx);
      }
    });
  }

  setTab(tab, cx) {
    if (this.tab === tab) return;
    // The commit detail panel is shared: a commit open on the Graph tab and a stash open on the
    // Refs tab would replace each other, so the open one is closed when moving into or out of Refs.
    if (this.sel && (tab === "refs" || this.tab === "refs")) this.clearSel();
    this.tab = LAST_TAB = tab;
    this.menu = false;
    if (tab === "prs") {
      this.prUsed = true;
      loadPrs(this, cx);
    }
    if (tab === "config") loadConfig(this, cx);
    if (tab === "refs") loadRefs(this, cx);
    if (tab === "graph") loadCurrentPr(this, cx);
    cx.notify();
  }

  loadMore(cx) {
    this.limit += PAGE;
    this.refresh(cx, true);
  }

  // Nothing under the branch menu is hit-blocked, so a click that picks a branch (or dismisses the
  // menu) would also reach the commit list or a toolbar button behind it. While the menu is open,
  // and for a moment after it closes, those handlers ignore clicks.
  blocked() {
    return this.menu || Date.now() < this.guard;
  }

  // The methods below forward to the feature modules; the modules (refs.js, prs.js, history.js, ...)
  // call them on the view, so they are the view's small interface.
  button(id, label, fn, t, opts) {
    return button(this, id, label, fn, t, opts);
  }
  small(id, label, fn, t, tone, opts) {
    return small(this, id, label, fn, t, tone, opts);
  }
  field(id, state, t) {
    return field(this, id, state, t);
  }
  pill(text, color) {
    return pill(this, text, color);
  }
  emptyState(text, color, t) {
    return emptyState(this, text, color, t);
  }
  op(label, args, cx, cmd, extra) {
    return op(this, label, args, cx, cmd, extra);
  }
  confirm(key, cx) {
    return confirmAction(this, key, cx);
  }
  writeBlock() {
    return writeBlock(this);
  }
  refuse(text, cx) {
    return refuse(this, text, cx);
  }
  clearSel() {
    return clearSel(this);
  }
  select(hash, cx) {
    return selectCommit(this, hash, cx);
  }
  jumpTo(hash, cx) {
    return jumpTo(this, hash, cx);
  }
  setDiff(lines) {
    return setDiff(this, lines);
  }
  diffView(t, mono) {
    return diffView(this, t, mono);
  }
  detailPanel(t, mono, c) {
    return detailPanel(this, t, mono, c);
  }

  render(cx) {
    return renderPanel(this, cx);
  }
}
