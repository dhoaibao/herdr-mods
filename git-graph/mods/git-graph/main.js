import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { spaces, panes, focused, exec, watchFolder, theme, settings, props } from "herdr";
import { loadPrs, prPanel, prToolbar, resetPrs } from "./prs.js";
import { initConfig, loadConfig, configPanel, configToolbar, resetConfig } from "./config.js";
import { initRefs, loadRefs, refsPanel, refsToolbar, resetRefs, validRefName, NAME_HELP } from "./refs.js";
import { parseStatus, inProgress } from "./status.js";

// Where the focused terminal is (same rule as the shipped Changes panel).
function location() {
  const space = spaces().find((s) => s.active),
    f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on =
    f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : (space?.machine ?? null);
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}

// Read-only git: no index refresh or lock, so our own folder watch is never triggered by us.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const ROW = 28,
  LANE = 16,
  MAX_LANES = 10,
  PAGE = 400;
/** Appends an alpha byte to a #rrggbb theme color; the cast satisfies the element API's hex-template type. */
const alpha = (color, a) => /** @type {`#${string}`} */ (color + a);
const FORMAT = "%H%x1f%P%x1f%an%x1f%ar%x1f%D%x1f%s%x1e";
// The git command that aborts each operation the banner can name (a `git am` has no Abort here).
const ABORT = { MERGING: "merge", REBASING: "rebase", "CHERRY-PICKING": "cherry-pick", REVERTING: "revert" };

function parseLog(text) {
  return text
    .split("\x1e")
    .map((r) => r.replace(/^\n/, ""))
    .filter(Boolean)
    .map((r) => {
      const [hash, parents, author, when, refs, subject] = r.split("\x1f");
      return {
        hash,
        short: hash.slice(0, 7),
        parents: parents ? parents.split(" ") : [],
        author,
        when,
        subject,
        refs: refs
          ? refs.split(", ").map((x) => {
              if (x.startsWith("HEAD -> ")) return { name: x.slice(8), kind: "head" };
              if (x === "HEAD") return { name: "HEAD", kind: "head" };
              if (x.startsWith("tag: ")) return { name: x.slice(5), kind: "tag" };
              return { name: x, kind: x.includes("/") ? "remote" : "local" };
            })
          : [],
      };
    });
}

// Whether a commit matches the (lowercased) search text: subject, author, a ref name, or the start of its hash.
function matches(c, q) {
  return (
    c.subject.toLowerCase().includes(q) ||
    c.author.toLowerCase().includes(q) ||
    c.hash.startsWith(q) ||
    c.refs.some((r) => r.name.toLowerCase().includes(q))
  );
}

// Assigns each commit a lane and records, per row, which lanes enter from above (before),
// leave below (after), and which other lanes join or branch off at this commit.
function layout(commits) {
  let lanes = [],
    max = 1;
  const rows = [];
  for (const c of commits) {
    const before = lanes.slice();
    let i = before.indexOf(c.hash);
    if (i < 0) {
      i = before.indexOf(null);
      if (i < 0) i = before.length;
    }
    const after = before.slice();
    while (after.length <= i) after.push(null);
    const joins = [],
      links = [];
    for (let j = 0; j < before.length; j++) {
      if (j !== i && before[j] === c.hash) {
        after[j] = null;
        joins.push(j);
      }
    }
    after[i] = c.parents[0] ?? null;
    for (const p of c.parents.slice(1)) {
      let k = after.indexOf(p);
      if (k < 0) {
        k = after.indexOf(null);
        if (k < 0) k = after.length;
        after[k] = p;
      }
      links.push(k);
    }
    while (after.length && after[after.length - 1] === null) after.pop();
    max = Math.max(max, before.length, after.length, i + 1);
    rows.push({ c, lane: i, before, after, joins, links, topIn: before[i] === c.hash });
    lanes = after;
  }
  return { rows, lanes: Math.min(max, MAX_LANES) };
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
  "signature",
  "limit",
];

export default class GitGraph extends View {
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
    this.prState = ["open", "merged", "closed"].includes(props()?.state) ? props().state : "open";
    this.prLoading = false;
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
      this.search = this.searchInput.value().trim().toLowerCase();
      this.curHit = null;
      this.hits();
      if (this.hitList.length) this.goHit(0, cx);
      else cx.notify();
    });
    this.searchInput.on("submit", (e, cx) => this.nextHit(e.shift ? -1 : 1, cx));
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
        const [refs, head, sym, ab, st, prog] = await Promise.all([
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
        if (work?.changed !== this.work?.changed || work?.conflicts !== this.work?.conflicts || prog !== this.inprog)
          changed = true;
        this.work = work;
        // An armed Abort belongs to the operation the banner showed; when it ends or another one
        // starts, the arm goes with it.
        if (prog !== this.inprog && this.armed?.startsWith("abort:")) this.armed = null;
        this.inprog = prog;
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
        if (!force && signature === this.signature) return;
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
          this.rows = [];
          this.error = log.stderr.trim() || "No commits yet";
          this.signature = signature;
          changed = true;
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
        CACHE.delete(context);
        CACHE.set(context, Object.fromEntries(CACHED.map((k) => [k, this[k]])));
        if (CACHE.size > 8) CACHE.delete(CACHE.keys().next().value);
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
    if (tab === "prs") loadPrs(this, cx);
    if (tab === "config") loadConfig(this, cx);
    if (tab === "refs") loadRefs(this, cx);
    cx.notify();
  }

  loadMore(cx) {
    this.limit += PAGE;
    this.refresh(cx, true);
  }

  // Runs one git command the user asked for (fetch, pull, push, switch, and the guarded writes of
  // ADR-007). One at a time; the outcome shows in the note bar, and the graph reloads afterwards.
  // extra.check(run) is a read-only precondition run first (`run(args)` is a READ git call) that
  // returns a refusal text or null; extra.ok replaces the success text; extra.done runs on success;
  // extra.keep leaves the success note up until it is clicked away (it carries a recovery command).
  op(label, args, cx, cmd = "git", extra = {}) {
    if (this.busy || !this.root) return;
    this.busy = label;
    this.note = null;
    this.armed = null;
    const context = this.context,
      root = this.root,
      on = this.on;
    cx.spawn(async (cx) => {
      let ok = false;
      try {
        const refusal = extra.check
          ? await extra.check((a) => exec("git", [...READ, ...a], { cwd: root, on, timeout: 30000 }))
          : null;
        if (this.context !== context) return;
        if (refusal) {
          this.note = { ok: false, text: refusal };
          return;
        }
        const r = await exec(cmd, args, { cwd: root, on, timeout: 120000 });
        if (this.context !== context) return;
        ok = r.code === 0;
        const out = `${r.stderr}\n${r.stdout}`.trim();
        this.note = {
          ok,
          text: ok
            ? (extra.ok ?? `${label}: done`)
            : out.split("\n").slice(-4).join("\n") || `${label} failed (exit ${r.code})`,
        };
        if (ok) extra.done?.();
      } catch (e) {
        this.note = { ok: false, text: `${label} failed: ${e}` };
      } finally {
        this.busy = null;
        this.signature = null;
        const mine = this.note;
        if (ok && !extra.keep)
          cx.timer.after(5000, (cx) => {
            // Only this operation's own note: a later one (a kept recovery note) must stay.
            if (this.note === mine) {
              this.note = null;
              cx.notify();
            }
          });
        cx.notify();
        this.refresh(cx, true);
      }
    });
    cx.notify();
  }

  fetch(cx) {
    this.op("Fetch", ["fetch", "--all", "--prune"], cx);
  }

  // Fast-forward only: a pull never creates a merge commit or rewrites anything on its own.
  pull(cx) {
    if (!this.branch) {
      this.note = { ok: false, text: "Detached HEAD: switch to a branch to pull" };
      cx.notify();
      return;
    }
    this.op("Pull", ["pull", "--ff-only"], cx);
  }

  // Push needs a second click within 5 s, and never forces. A branch without an upstream is
  // published to origin and set up to track it.
  push(cx) {
    if (this.busy || !this.root) return;
    if (!this.branch) {
      this.note = { ok: false, text: "Detached HEAD: switch to a branch to push" };
      cx.notify();
      return;
    }
    if (!this.sync && this.upstreamGone) {
      this.note = {
        ok: false,
        text: `Upstream of ${this.branch} no longer exists on the remote. Not re-publishing; run \`git push -u <remote> ${this.branch}\` yourself if you want that.`,
      };
      cx.notify();
      return;
    }
    if (!this.confirm("push", cx)) return;
    this.op("Push", this.sync ? ["push"] : ["push", "-u", "origin", "HEAD"], cx);
  }

  // Two-click actions: the first click arms the action for 5 s (its button shows it) and returns
  // false; a second click on the same action inside that window returns true.
  confirm(key, cx) {
    if (this.busy) return false;
    if (this.armed === key) {
      this.armed = null;
      return true;
    }
    const seq = ++this.armSeq;
    this.armed = key;
    cx.timer.after(5000, (cx) => {
      if (this.armSeq === seq && this.armed === key) {
        this.armed = null;
        cx.notify();
      }
    });
    cx.notify();
    return false;
  }

  // Why a guarded write must not run now, or null. A merge, rebase, cherry-pick, revert or patch in
  // progress would be tangled up with it.
  writeBlock() {
    if (!this.inprog) return null;
    return ABORT[this.inprog]
      ? `${this.inprog}: finish it in a terminal, or use Abort in the banner, first`
      : `${this.inprog}: finish or abort it in a terminal first`;
  }

  // Shows a refusal in the note bar instead of running anything.
  refuse(text, cx) {
    this.note = { ok: false, text };
    cx.notify();
  }

  // Nothing under the branch menu is hit-blocked, so a click that picks a branch (or dismisses the
  // menu) would also reach the commit list or a toolbar button behind it. While the menu is open,
  // and for a moment after it closes, those handlers ignore clicks.
  blocked() {
    return this.menu || Date.now() < this.guard;
  }

  closeMenu(cx) {
    this.menu = false;
    this.guard = Date.now() + 400;
    cx.notify();
  }

  openMenu(cx) {
    if (this.menu) {
      this.closeMenu(cx);
      return;
    }
    this.menu = true;
    this.filter = "";
    this.input.set_value("");
    this.loadBranches(cx);
    cx.timer.after(60, (cx) => this.input.focus());
    cx.notify();
  }

  loadBranches(cx) {
    const context = this.context,
      root = this.root,
      on = this.on;
    cx.spawn(async (cx) => {
      try {
        const r = await exec(
          "git",
          [...READ, "for-each-ref", "--sort=-committerdate", "--format=%(refname)", "refs/heads", "refs/remotes"],
          { cwd: root, on },
        );
        if (this.context !== context) return;
        const local = [],
          remote = [];
        for (const ref of r.stdout.split("\n").filter(Boolean)) {
          // A name starting with "-" would be parsed by `git switch` as an option.
          if (ref.startsWith("refs/heads/") && ref[11] !== "-") local.push(ref.slice(11));
          else if (ref.startsWith("refs/remotes/") && ref[13] !== "-" && !ref.endsWith("/HEAD"))
            remote.push(ref.slice(13));
        }
        const have = new Set(local);
        this.branches = [
          ...local.map((n) => ({ key: `l:${n}`, name: n, kind: "local" })),
          ...remote
            .filter((n) => !have.has(n.slice(n.indexOf("/") + 1)))
            .map((n) => ({ key: `r:${n}`, name: n, kind: "remote" })),
        ];
      } catch {
        this.branches = [];
      }
      cx.notify();
    });
  }

  menuItems() {
    const f = this.filter.toLowerCase();
    const items = this.branches.filter((b) => !f || b.name.toLowerCase().includes(f));
    const valid = validRefName(this.filter);
    const exists = this.branches.some((b) => b.kind === "local" && b.name === this.filter);
    return this.filter && valid && !exists
      ? [{ key: `n:${this.filter}`, name: this.filter, kind: "new" }, ...items]
      : items;
  }

  checkout(key, cx) {
    const kind = key[0],
      name = key.slice(2);
    this.closeMenu(cx);
    if (name.startsWith("-")) return;
    if (kind === "n") this.op(`Create ${name}`, ["switch", "-c", name], cx);
    else this.op(`Switch to ${name}`, kind === "r" ? ["switch", "--track", name] : ["switch", name], cx);
  }

  // icon: a name for mods/git-graph/<icon>.svg, drawn in the button's text colour.
  button(id, label, fn, t, { disabled = false, tone = null, icon = null } = {}) {
    const color = disabled ? t.dim : (tone ?? t.muted);
    return div()
      .id(id)
      .px(12)
      .h(28)
      .flex_none()
      .flex()
      .items_center()
      .gap(6)
      .rounded(6)
      .border_1()
      .border_color(tone ?? t.border)
      .text_size(13)
      .text_color(color)
      .when(!disabled, (e) =>
        e
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => {
            if (!this.blocked()) fn(cx);
          }),
      )
      .children([
        ...(icon ? [svg(`mods/git-graph/${icon}.svg`).size(14).flex_none().text_color(color)] : []),
        ...(Array.isArray(label) ? label : [label]),
      ]);
  }

  // Loading, empty and error text for a list area: centred over it instead of tucked in the corner.
  emptyState(text, color, t) {
    return div()
      .absolute()
      .inset_0()
      .flex()
      .items_center()
      .justify_center()
      .px(24)
      .text_center()
      .text_color(color ?? t.dim)
      .child(text);
  }

  branchRow(b, t) {
    const current = b.kind === "local" && b.name === this.branch;
    return h_flex()
      .w_full()
      .h(ROW)
      .flex_none()
      .px(12)
      .gap(8)
      .items_center()
      .cursor_pointer()
      .when(current, (e) => e.bg(alpha(t.accent, "18")))
      .hover((s) => s.bg(t.hover))
      .child(
        div()
          .w(14)
          .flex_none()
          .text_color(b.kind === "new" ? t.accent : t.ansi2)
          .child(current ? "●" : b.kind === "new" ? "+" : ""),
      )
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .text_color(b.kind === "new" ? t.accent : t.foreground)
          .when(current, (e) => e.font_semibold())
          .child(b.kind === "new" ? `Create branch "${b.name}"` : b.name),
      )
      .when(b.kind === "remote", (e) => e.child(this.pill("remote", t.ansi4).h(18).px(5).text_size(11)));
  }

  menuPanel(t) {
    const items = this.menuItems();
    return div()
      .absolute()
      .inset_0()
      .child(
        div()
          .id("gg-backdrop")
          .absolute()
          .inset_0()
          .on_click((_e, cx) => this.closeMenu(cx)),
      )
      .child(
        v_flex()
          .id("gg-menu")
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .absolute()
          .left(14)
          .top(50)
          .w(380)
          .h(Math.min(380, 56 + items.length * ROW))
          .rounded(8)
          .bg(t.popover)
          .border_1()
          .border_color(t.border)
          .shadow_lg()
          .overflow_hidden()
          .child(
            div()
              .id("gg-find")
              .h(40)
              .flex_none()
              .px(12)
              .flex()
              .items_center()
              .border_b(1)
              .border_color(t.border)
              .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
              .child(Input.new(this.input).h_full().text_size(13).text_color(t.foreground)),
          )
          .child(
            div()
              .flex_1()
              .min_h(0)
              .relative()
              .child(
                v_virtual_list(
                  "gg-branches",
                  items.length,
                  ROW,
                  (i) => items[i].key,
                  (range) => items.slice(range.start, range.end).map((b) => this.branchRow(b, t)),
                )
                  .size_full()
                  .on_item_click((key, cx) => this.checkout(key, cx)),
              )
              .child(Scrollbar.vertical("gg-branches").viewport_from_layout().absolute().inset_0())
              .when(!items.length, (e) =>
                e.child(div().absolute().top(8).px(12).text_color(t.dim).child("No matching branch")),
              ),
          ),
      );
  }

  clearSel() {
    this.sel = null;
    this.detail = null;
    this.meta = null;
    this.files = [];
    this.openFile = null;
    this.setDiff([]);
    // A pending Pop, Drop, Cherry-pick or Revert belongs to the item that was open.
    if (/^(pop|drop|cherry-pick|revert):/.test(this.armed ?? "")) this.armed = null;
  }

  select(hash, cx) {
    if (this.sel === hash) {
      this.clearSel();
      cx.notify();
      return;
    }
    this.clearSel();
    this.sel = hash;
    const context = this.context,
      root = this.root,
      on = this.on;
    const git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
    const same = () => this.sel === hash && this.context === context;
    cx.spawn(async (cx) => {
      try {
        // -m --first-parent: a merge shows what it brought in against its first parent.
        const [info, stat, names] = await Promise.all([
          git([
            "show",
            "-s",
            "--no-color",
            "--date=format:%Y-%m-%d %H:%M",
            "--format=%an%x1f%ae%x1f%cn%x1f%ce%n%ad%n%n%B",
            hash,
          ]),
          git(["show", "--format=", "--numstat", "-z", "--no-renames", "-m", "--first-parent", hash]),
          git(["show", "--format=", "--name-status", "-z", "--no-renames", "-m", "--first-parent", hash]),
        ]);
        if (!same()) return;
        if (info.code !== 0) throw new Error(info.stderr);
        // First line: author and committer fields; the rest is [date, "", message...].
        const [people, ...rest] = info.stdout.replace(/\n+$/, "").split("\n").slice(0, 60);
        const [author, email = "", committer = "", committerEmail = ""] = people.split("\x1f");
        this.meta = { email, committer, committerEmail };
        this.detail = [author, ...rest];
        const counts = {};
        for (const entry of stat.stdout.split("\0")) {
          const [a, d, ...parts] = entry.split("\t");
          if (parts.length) counts[parts.join("\t")] = { add: Number(a) || 0, del: Number(d) || 0, binary: a === "-" };
        }
        const parts = names.stdout.split("\0").filter(Boolean),
          files = [];
        for (let i = 0; i + 1 < parts.length && files.length < 1000; i += 2) {
          files.push({ status: parts[i][0], path: parts[i + 1], ...(counts[parts[i + 1]] ?? { add: 0, del: 0 }) });
        }
        this.files = files;
      } catch (e) {
        if (same()) this.detail = [String(e)];
      }
      cx.notify();
    });
    cx.notify();
  }

  // The rows that match the search, recomputed only when the rows or the text changed. While the
  // box is hidden (a narrow overlay) the search counts as empty, so no row stays dimmed unexplained;
  // hitQuery is the text actually applied.
  hits() {
    const q = this.roomy ? this.search : "";
    if (this.hitRows === this.rows && this.hitQuery === q) return;
    this.hitRows = this.rows;
    this.hitQuery = q;
    this.hitList = [];
    this.hitSet = new Set();
    if (q) {
      this.rows.forEach((r, i) => {
        if (matches(r.c, q)) {
          this.hitList.push(i);
          this.hitSet.add(r.c.hash);
        }
      });
    }
    if (this.curHit && !this.hitSet.has(this.curHit)) this.curHit = null;
  }

  goHit(i, cx) {
    const at = this.hitList[i];
    this.curHit = this.rows[at].c.hash;
    this.scroll.scroll_to_item(at, "center");
    cx.notify();
  }

  nextHit(step, cx) {
    this.hits();
    const n = this.hitList.length;
    if (!n) return;
    const cur = this.hitList.findIndex((at) => this.rows[at].c.hash === this.curHit);
    this.goHit(cur < 0 ? (step > 0 ? 0 : n - 1) : (cur + step + n) % n, cx);
  }

  // A bordered one-line input (the caller sets its width). The mouse-down guard keeps the click from
  // reaching what lies behind it.
  field(id, state, t) {
    return div()
      .id(id)
      .h(28)
      .flex_none()
      .px(10)
      .flex()
      .items_center()
      .rounded(6)
      .border_1()
      .border_color(t.border)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(Input.new(state).h_full().text_size(13).text_color(t.foreground));
  }

  // The search box with its match count and step buttons.
  searchBox(t) {
    const n = this.hitList.length,
      at = this.hitList.findIndex((i) => this.rows[i].c.hash === this.curHit);
    return h_flex()
      .flex_none()
      .gap(8)
      .items_center()
      .child(this.field("gg-search", this.searchInput, t).w(200))
      .when(Boolean(this.search), (e) =>
        e.child(
          div()
            .flex_none()
            .text_size(12)
            .text_color(n ? t.muted : t.ansi1)
            .child(
              n
                ? at < 0
                  ? `${n} match${n === 1 ? "" : "es"}`
                  : `${at + 1}/${n}`
                : this.more
                  ? "No match in loaded commits"
                  : "No match",
            ),
        ),
      )
      .when(n > 1, (e) =>
        e
          // Like the toolbar buttons, ignore a click that only dismissed the branch menu.
          .child(this.small("gg-hit-prev", "↑", (cx) => !this.blocked() && this.nextHit(-1, cx), t))
          .child(this.small("gg-hit-next", "↓", (cx) => !this.blocked() && this.nextHit(1, cx), t)),
      );
  }

  // The commit the detail panel shows, when it is a row of the graph and a write may run on it.
  writeTarget(cx) {
    const c = this.rows.find((r) => r.c.hash === this.sel)?.c;
    if (!c || !/^[0-9a-f]{40,64}$/.test(c.hash)) return null;
    const block = this.writeBlock();
    if (block) {
      this.refuse(block, cx);
      return null;
    }
    return c;
  }

  // `git branch <name> <hash>` or `git tag [-a -m <msg>] <name> <hash>`: creates a ref and moves nothing.
  // The name is checked here and by `git check-ref-format`; git itself refuses one that exists.
  createRef(kind, cx) {
    const c = this.writeTarget(cx);
    if (!c) return;
    const name = this.refName.value().trim(),
      msg = this.refMsg.value().trim(),
      tag = kind === "tag";
    if (!validRefName(name)) {
      this.refuse(NAME_HELP, cx);
      return;
    }
    const args = tag
      ? msg
        ? ["tag", "-a", name, "-m", msg, c.hash]
        : ["tag", name, c.hash]
      : ["branch", name, c.hash];
    this.op(`${tag ? "Tag" : "Branch"} ${name}`, args, cx, "git", {
      check: async (run) =>
        (await run(["check-ref-format", `${tag ? "refs/tags/" : "refs/heads/"}${name}`])).code === 0
          ? null
          : `"${name}" is not a valid ${tag ? "tag" : "branch"} name`,
      ok: `${tag ? "Tagged" : "Created branch"} ${name} at ${c.short}`,
      done: () => {
        this.refName.set_value("");
        this.refMsg.set_value("");
      },
    });
  }

  // Cherry-pick or revert the selected commit onto the current branch. Two clicks, because it creates a
  // commit; the tracked files must be clean (checked right before it runs), a merge commit is refused
  // (git needs -m for it), and a detached HEAD is refused (the new commit would be easy to lose). A
  // conflict leaves the operation in progress: the banner offers Abort, and finishing is left to a terminal.
  pickCommit(kind, cx) {
    const c = this.writeTarget(cx);
    if (!c) return;
    const revert = kind === "revert";
    if (c.parents.length > 1)
      return this.refuse(
        `A merge commit cannot be ${revert ? "reverted" : "cherry-picked"} here: use a terminal (git needs -m)`,
        cx,
      );
    if (!this.branch) return this.refuse("Detached HEAD: switch to a branch first", cx);
    if (!this.confirm(`${kind}:${c.hash}`, cx)) return;
    this.op(
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
        ok: `${revert ? "Reverted" : "Cherry-picked"} ${c.short} onto ${this.branch}`,
      },
    );
  }

  // Abort the merge, rebase, cherry-pick or revert in progress (`<op> --abort`). Two clicks, because it
  // discards the work done on that operation so far, and only while that operation is still the one in
  // progress (re-read right before it runs). This is the one write that is allowed while `inprog` is set.
  abort(cx) {
    const kind = this.inprog,
      cmd = ABORT[kind];
    if (!cmd || this.busy || !this.root) return;
    if (!this.confirm(`abort:${kind}`, cx)) return;
    const root = this.root,
      on = this.on;
    this.op(`Abort ${cmd}`, [cmd, "--abort"], cx, "git", {
      check: async (run) => ((await inProgress(run, root, on)) === kind ? null : `The ${cmd} is no longer in progress`),
      ok: `Aborted the ${cmd}`,
    });
  }

  // `git switch --detach <hash>`: git refuses it when local changes would be overwritten.
  detach(cx) {
    const c = this.writeTarget(cx);
    if (c) this.op(`Check out ${c.short} (detached)`, ["switch", "--detach", c.hash], cx);
  }

  copyHash(hash, cx) {
    cx.write_to_clipboard(hash);
    this.note = { ok: true, text: `Copied ${hash.slice(0, 7)}` };
    cx.timer.after(3000, (cx) => {
      if (this.note?.ok && this.note.text.startsWith("Copied ")) {
        this.note = null;
        cx.notify();
      }
    });
    cx.notify();
  }

  // Selects a commit that is already in the loaded graph and scrolls its row to the middle.
  jumpTo(hash, cx) {
    const at = this.rows.findIndex((r) => r.c.hash === hash);
    if (at < 0) {
      this.note = { ok: false, text: `${hash.slice(0, 7)} is not in the loaded graph. Load more commits to reach it.` };
      cx.notify();
      return;
    }
    if (this.sel !== hash) this.select(hash, cx);
    this.scroll.scroll_to_item(at, "center");
  }

  pickFile(path, cx) {
    this.openFile = path;
    this.setDiff(["Loading…"]);
    const hash = this.sel,
      context = this.context,
      root = this.root,
      on = this.on;
    const same = () => this.sel === hash && this.openFile === path && this.context === context;
    cx.spawn(async (cx) => {
      let lines;
      try {
        const r = await exec(
          "git",
          [
            ...READ,
            "show",
            "--format=",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            "-m",
            "--first-parent",
            hash,
            "--",
            path,
          ],
          { cwd: root, on },
        );
        if (r.code !== 0) throw new Error(r.stderr);
        const all = r.stdout.replace(/\n$/, "").split("\n"),
          first = all.findIndex((l) => l.startsWith("@@"));
        lines = first < 0 ? ["No text diff (binary file or mode change)"] : all.slice(first);
      } catch (e) {
        lines = [`Cannot show this diff: ${e}`];
      }
      if (same())
        this.setDiff(lines.slice(0, 2000).map((l) => (l.length > 4000 ? l.slice(0, 4000) + "… (line truncated)" : l)));
      cx.notify();
    });
    cx.notify();
  }

  setDiff(lines) {
    let old = 0,
      next = 0;
    const rows = lines.map((line) => {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(line);
      if (m) {
        old = +m[1];
        next = +m[2];
        return { kind: "@", text: line, range: line.slice(0, line.length - m[3].length).trimEnd(), context: m[3] };
      }
      const kind = line[0],
        text = line.slice(1).replace(/\t/g, "    ") || " ";
      if (kind === "-") return { kind, old: old++, text };
      if (kind === "+") return { kind, next: next++, text };
      if (kind === " ") return { kind, old: old++, next: next++, text };
      return { kind: "", text: line };
    });
    // Mark what changed inside a line: a run of removed lines followed by added lines is paired
    // in order, and the stretch between their shared start and end (widened to whole words) is
    // drawn stronger than the rest of the line.
    for (let i = 0; i < rows.length;) {
      if (rows[i].kind !== "-") {
        i++;
        continue;
      }
      const a = i;
      while (i < rows.length && rows[i].kind === "-") i++;
      const b = i;
      while (i < rows.length && rows[i].kind === "+") i++;
      for (let k = 0; k < Math.min(b - a, i - b); k++) this.markWords(rows[a + k], rows[b + k]);
    }
    this.diff = rows;
    this.diffWidth = Math.max(300, ...lines.map((l) => l.length * 8 + 120));
  }

  markWords(del, add) {
    const x = del.text,
      y = add.text,
      word = /\w/;
    let p = 0;
    while (p < x.length && p < y.length && x[p] === y[p]) p++;
    let s = 0;
    while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
    while (p > 0 && word.test(x[p - 1]) && (word.test(x[p] ?? "") || word.test(y[p] ?? ""))) p--;
    while (s > 0 && word.test(x[x.length - s]) && word.test(x[x.length - s - 1] ?? "")) s--;
    if (p + s === 0 || (p === 0 && s === 0)) return; // nothing shared: the whole line is the change
    const split = (text, end) =>
      [
        { text: text.slice(0, p) },
        { text: text.slice(p, text.length - end), hl: true },
        { text: text.slice(text.length - end) },
      ].filter((q) => q.text);
    del.parts = split(x, s);
    add.parts = split(y, s);
  }

  diffRow(row, t) {
    const { kind, text } = row;
    if (kind === "@")
      return h_flex()
        .w_full()
        .h(22)
        .flex_none()
        .px(12)
        .gap(10)
        .items_center()
        .bg(t.raised)
        .border_t(1)
        .border_color(t.border)
        .child(div().flex_none().whitespace_nowrap().text_color(t.accent).child(row.range))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(row.context));
    const add = kind === "+",
      del = kind === "-",
      tint = add ? t.ansi2 : t.ansi1;
    const cell = (n) =>
      div()
        .w(44)
        .flex_none()
        .h_full()
        .flex()
        .items_center()
        .justify_end()
        .pr(6)
        .text_color(add || del ? tint : t.dim)
        .when(add || del, (e) => e.bg(alpha(tint, "30")))
        .child(n === undefined ? "" : String(n));
    return h_flex()
      .w_full()
      .h(22)
      .flex_none()
      .items_center()
      .when(add || del, (e) => e.bg(alpha(tint, "18")))
      .child(cell(row.old))
      .child(cell(row.next))
      .child(
        div()
          .w(18)
          .flex_none()
          .text_center()
          .text_color(add || del ? tint : t.dim)
          .child(add ? "+" : del ? "−" : ""),
      )
      .child(
        h_flex()
          .flex_1()
          .min_w(0)
          .overflow_hidden()
          .text_color(add || del ? t.foreground : t.muted)
          .children(
            (row.parts ?? [{ text }]).map((q) =>
              div()
                .flex_none()
                .whitespace_nowrap()
                .when(q.hl, (e) => e.bg(alpha(tint, "55")).rounded(3))
                .child(q.text),
            ),
          ),
      );
  }

  tabButton(id, label, name, t) {
    const on = this.tab === name;
    return div()
      .id(id)
      .px(12)
      .h_full()
      .flex()
      .items_center()
      .text_size(14)
      .text_color(on ? t.foreground : t.muted)
      .border_b(2)
      .border_color(on ? t.accent : t.background)
      .cursor_pointer()
      .hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => {
        if (!this.blocked()) this.setTab(name, cx);
      })
      .child(label);
  }

  // A small bordered button for the detail panels (no icon; callers gate on blocked() when the branch menu could be over it).
  small(id, label, fn, t, tone = null) {
    return div()
      .id(id)
      .px(10)
      .h(26)
      .flex_none()
      .flex()
      .items_center()
      .rounded(6)
      .border_1()
      .border_color(tone ?? t.border)
      .text_size(13)
      .text_color(tone ?? t.muted)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => fn(cx))
      .child(label);
  }

  // The parsed diff in this.diff: scrolls both ways, one line per row.
  diffView(t, mono) {
    return div()
      .flex_1()
      .min_h(0)
      .relative()
      .font_family(mono)
      .text_size(13)
      .child(
        div()
          .id("gg-diff-x")
          .size_full()
          .overflow_x_scrollbar()
          .child(
            div()
              .w_full()
              .min_w(this.diffWidth)
              .h_full()
              .child(
                v_virtual_list(
                  "gg-diff",
                  this.diff.length,
                  22,
                  (i) => String(i),
                  (range) => this.diff.slice(range.start, range.end).map((row) => this.diffRow(row, t)),
                ).size_full(),
              ),
          ),
      )
      .child(Scrollbar.vertical("gg-diff").viewport_from_layout().absolute().inset_0());
  }

  // The selected commit: its message and changed files, or one file's diff.
  // `c` is the commit shown; the Refs tab passes a stash (a commit the graph log does not list).
  detailPanel(t, mono, c = this.rows.find((r) => r.c.hash === this.sel)?.c) {
    const btn = (id, label, fn) => this.small(id, label, fn, t);
    // The buttons that write ignore a click that only dismissed the branch menu.
    const guarded = (fn) => (cx) => {
      if (!this.blocked()) fn(cx);
    };
    const history = this.tab === "graph" && Boolean(c);
    const pickBtn = (id, kind, label) => {
      const armed = this.armed === `${kind}:${c?.hash}`;
      return this.small(
        id,
        armed ? `Click again to ${label.toLowerCase()}` : label,
        guarded((cx) => this.pickCommit(kind, cx)),
        t,
        armed ? t.ansi1 : null,
      );
    };
    const head = h_flex()
      .h(40)
      .flex_none()
      .px(12)
      .gap(8)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .when(this.openFile, (e) =>
        e
          .child(
            btn("gg-back", "‹ Files", (cx) => {
              this.openFile = null;
              this.setDiff([]);
              cx.notify();
            }),
          )
          .child(div().flex_1().min_w(0).truncate().font_family(mono).text_size(13).child(this.openFile)),
      )
      .when(!this.openFile, (e) =>
        e
          .child(
            div()
              .font_family(mono)
              .text_size(13)
              .text_color(t.accent)
              .child(c?.short ?? ""),
          )
          .child(
            div()
              .text_size(13)
              .text_color(t.muted)
              .child(`${this.files.length} file${this.files.length === 1 ? "" : "s"} changed`),
          )
          .when(
            this.files.some((f) => f.add || f.del),
            (e2) =>
              e2
                .child(
                  div()
                    .text_size(13)
                    .text_color(t.ansi2)
                    .child(`+${this.files.reduce((n, f) => n + f.add, 0)}`),
                )
                .child(
                  div()
                    .text_size(13)
                    .text_color(t.ansi1)
                    .child(`−${this.files.reduce((n, f) => n + f.del, 0)}`),
                ),
          )
          .child(div().flex_1())
          .when(history, (e2) =>
            e2
              .child(pickBtn("gg-cherry", "cherry-pick", "Cherry-pick"))
              .child(pickBtn("gg-revert", "revert", "Revert")),
          )
          .child(
            btn("gg-close", "Close", (cx) => {
              this.clearSel();
              cx.notify();
            }),
          ),
      );
    // detail is [author, date, "", subject, ...body]: author and date share one muted line and the
    // subject is set apart from the body. Loading and error text (one line) is shown as is.
    const loaded = this.detail?.length >= 2;
    const lines = loaded ? this.detail.slice(3) : [];
    while (lines.length && !lines[0].trim()) lines.shift();
    // Shown only when the committer differs from the author (a rebase, cherry-pick or applied patch).
    const m = this.meta,
      committed =
        loaded && m && (m.committer !== this.detail[0] || m.committerEmail !== m.email)
          ? `${m.committer}${m.committerEmail ? ` <${m.committerEmail}>` : ""}`
          : "";
    const message = loaded
      ? [
          div()
            .flex_none()
            .min_h(22)
            .text_size(15)
            .font_semibold()
            .text_color(t.foreground)
            .child(lines[0] || "(no message)"),
          div()
            .flex_none()
            .min_h(18)
            .text_size(12)
            .text_color(t.dim)
            .child(`${this.detail[0]}${this.meta?.email ? ` <${this.meta.email}>` : ""} · ${this.detail[1]}`),
          ...(committed
            ? [div().flex_none().min_h(18).text_size(12).text_color(t.dim).child(`Committed by ${committed}`)]
            : []),
          h_flex()
            .flex_none()
            .h(30)
            .gap(8)
            .items_center()
            .child(
              div()
                .flex_1()
                .min_w(0)
                .truncate()
                .font_family(mono)
                .text_size(12)
                .text_color(t.muted)
                .child(c?.hash ?? ""),
            )
            .child(this.small("gg-copy", "Copy", (cx) => this.copyHash(c.hash, cx), t)),
          ...(c?.parents.length
            ? [
                h_flex()
                  .flex_none()
                  .min_h(26)
                  .gap(8)
                  .items_center()
                  .child(
                    div()
                      .flex_none()
                      .text_size(12)
                      .text_color(t.dim)
                      .child(c.parents.length > 1 ? "Parents" : "Parent"),
                  )
                  .children(
                    c.parents.map((p) =>
                      div()
                        .id(`gg-parent-${p}`)
                        .flex_none()
                        .px(6)
                        .rounded(4)
                        .font_family(mono)
                        .text_size(12)
                        .text_color(t.accent)
                        .cursor_pointer()
                        .hover((s) => s.bg(t.hover))
                        .on_click((_e, cx) => this.jumpTo(p, cx))
                        .child(p.slice(0, 7)),
                    ),
                  ),
              ]
            : []),
          ...(lines.length > 1
            ? [
                div().h(6).flex_none(),
                ...lines.slice(1).map((text) =>
                  div()
                    .flex_none()
                    .min_h(18)
                    .text_color(t.muted)
                    .child(text || " "),
                ),
              ]
            : []),
        ]
      : [
          div()
            .flex_none()
            .text_color(t.muted)
            .child(this.detail?.[0] ?? "Loading…"),
        ];
    const body = this.openFile
      ? this.diffView(t, mono)
      : v_flex()
          .id("gg-detail")
          .flex_1()
          .min_h(0)
          .overflow_y_scroll()
          .px(14)
          .py(12)
          .gap(1)
          .text_size(13)
          .children(message)
          .child(div().h(10).flex_none())
          .children(
            this.files.map((f) =>
              h_flex()
                .id(`gg-f-${f.path}`)
                .font_family(mono)
                .min_h(28)
                .flex_none()
                .px(6)
                .gap(8)
                .items_center()
                .rounded(6)
                .cursor_pointer()
                .hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => this.pickFile(f.path, cx))
                .child(
                  (() => {
                    const c = f.status === "A" ? t.ansi2 : f.status === "D" ? t.ansi1 : t.ansi3;
                    return div()
                      .w(18)
                      .h(18)
                      .flex_none()
                      .flex()
                      .items_center()
                      .justify_center()
                      .rounded(4)
                      .bg(alpha(c, "22"))
                      .text_size(12)
                      .text_color(c)
                      .child(f.status);
                  })(),
                )
                .child(
                  (() => {
                    // The file name stands out; its directory is muted so long paths stay scannable.
                    const cut = f.path.lastIndexOf("/");
                    return h_flex()
                      .flex_1()
                      .min_w(0)
                      .overflow_hidden()
                      .whitespace_nowrap()
                      .child(
                        div()
                          .min_w(0)
                          .truncate()
                          .text_color(t.dim)
                          .child(cut >= 0 ? f.path.slice(0, cut + 1) : ""),
                      )
                      .child(
                        div()
                          .flex_none()
                          .child(f.path.slice(cut + 1)),
                      );
                  })(),
                )
                .when(f.add > 0, (e) => e.child(div().text_color(t.ansi2).child(`+${f.add}`)))
                .when(f.del > 0, (e) => e.child(div().text_color(t.ansi1).child(`−${f.del}`))),
            ),
          );
    // Branch, tag or detached checkout at this commit; only for a graph commit (not a stash).
    const actions =
      this.tab === "graph" && !this.openFile && c
        ? h_flex()
            .h(44)
            .flex_none()
            .px(12)
            .gap(8)
            .items_center()
            .border_b(1)
            .border_color(t.border)
            .child(this.field("gg-ref-name", this.refName, t).w(170))
            .child(this.field("gg-ref-msg", this.refMsg, t).flex_1().min_w(0))
            .child(
              btn(
                "gg-branch-here",
                "Branch here",
                guarded((cx) => this.createRef("branch", cx)),
              ),
            )
            .child(
              btn(
                "gg-tag-here",
                "Tag here",
                guarded((cx) => this.createRef("tag", cx)),
              ),
            )
            .child(
              btn(
                "gg-detach",
                "Check out (detached)",
                guarded((cx) => this.detach(cx)),
              ),
            )
        : null;
    return v_flex()
      .h(340)
      .flex_none()
      .border_t(1)
      .border_color(t.border)
      .child(head)
      .when(Boolean(actions), (e) => e.child(actions))
      .child(body);
  }

  graph(row, t) {
    const pal = [t.accent, t.ansi2, t.ansi3, t.ansi5, t.ansi6, t.ansi1, t.ansi4, t.ansi10];
    const color = (j) => pal[j % pal.length],
      x = (j) => 8 + j * LANE,
      half = ROW / 2;
    const { lane, before, after, joins, links, topIn } = row;
    const n = Math.min(Math.max(before.length, after.length, lane + 1), MAX_LANES);
    const out = [],
      R = 8,
      W = 2;
    // A lane that bends into the commit's lane ends (or starts) one radius short of the
    // commit's row, where a quarter-circle takes over; a lane that also carries on straight keeps
    // its full line.
    const bendUp = new Set(joins),
      bendDown = new Set(links);
    for (let j = 0; j < n; j++) {
      const top = j === lane ? topIn : before[j] != null,
        bottom = after[j] != null;
      if (!top && !bottom) continue;
      const y0 = top ? 0 : bendDown.has(j) && j !== lane ? half + R : half;
      const y1 = bottom ? ROW : bendUp.has(j) && j !== lane ? half - R : half;
      if (y1 > y0)
        out.push(
          div()
            .absolute()
            .left(x(j) - 1)
            .top(y0)
            .w(W)
            .h(y1 - y0)
            .bg(color(j)),
        );
    }
    const bend = (j, down) => {
      if (j >= MAX_LANES || lane >= MAX_LANES || j === lane) return;
      const right = j > lane,
        c = color(j),
        xa = x(lane),
        xj = x(j);
      // Straight run along the commit's row, then the arc into lane j.
      const from = right ? xa : xj + R,
        to = right ? xj - R : xa;
      if (to > from)
        out.push(
          div()
            .absolute()
            .left(from)
            .top(half - 1)
            .w(to - from)
            .h(W)
            .bg(c),
        );
      const arc = div()
        .absolute()
        .left(right ? xj - R : xj - 1)
        .top(down ? half - 1 : half - R)
        .w(R + 1)
        .h(R + 1)
        .border_color(c)
        .when(down, (e) => e.border_t(W))
        .when(!down, (e) => e.border_b(W))
        .when(right, (e) => e.border_r(W))
        .when(!right, (e) => e.border_l(W));
      out.push(down ? (right ? arc.rounded_tr(R) : arc.rounded_tl(R)) : right ? arc.rounded_br(R) : arc.rounded_bl(R));
    };
    for (const j of joins) bend(j, false);
    for (const j of links) bend(j, true);
    if (lane < MAX_LANES && row.c.refs.some((r) => r.kind === "head")) {
      // The checked-out commit: a ring in the accent color around a filled core.
      out.push(
        div()
          .absolute()
          .left(x(lane) - 7)
          .top(half - 7)
          .w(14)
          .h(14)
          .rounded(7)
          .bg(t.background)
          .border_2()
          .border_color(t.accent)
          .flex()
          .items_center()
          .justify_center()
          .child(div().w(6).h(6).rounded(3).bg(t.accent)),
      );
    } else if (lane < MAX_LANES) {
      const merge = row.c.parents.length > 1;
      out.push(
        div()
          .absolute()
          .left(x(lane) - 4)
          .top(half - 4)
          .w(8)
          .h(8)
          .rounded(4)
          .bg(merge ? t.background : color(lane))
          .border_1()
          .border_color(color(lane)),
      );
    }
    return div()
      .relative()
      .flex_none()
      .w(this.lanes * LANE + 10)
      .h(ROW)
      .children(out);
  }

  chip(ref, t) {
    const c = ref.kind === "head" ? t.accent : ref.kind === "tag" ? t.ansi3 : ref.kind === "remote" ? t.ansi4 : t.ansi2;
    const head = ref.kind === "head";
    return div()
      .flex_none()
      .max_w(140)
      .h(20)
      .px(6)
      .flex()
      .items_center()
      .rounded(4)
      .border_1()
      .border_color(alpha(c, head ? "ff" : "88"))
      .bg(alpha(c, head ? "38" : "1c"))
      .text_color(c)
      .text_size(12)
      .when(head, (e) => e.font_semibold())
      .truncate()
      .child(ref.name);
  }

  // A small tinted pill: the ahead/behind counts beside the branch chip, and `remote` in the branch menu.
  pill(text, color) {
    return div()
      .flex_none()
      .h(20)
      .px(6)
      .flex()
      .items_center()
      .rounded(10)
      .bg(alpha(color, "22"))
      .text_size(12)
      .text_color(color)
      .child(text);
  }

  row(row, t) {
    const c = row.c,
      picked = this.sel === c.hash;
    // With a search, rows that do not match are dimmed (not removed, so the lanes stay intact) and
    // the match the list last moved to is tinted.
    const miss = Boolean(this.hitQuery) && !this.hitSet.has(c.hash),
      current = c.hash === this.curHit;
    // No handlers in a virtual list's renderer: clicks come from on_item_click on the list.
    const merge = c.parents.length > 1;
    return h_flex()
      .w_full()
      .h(ROW)
      .flex_none()
      .pr(10)
      .gap(6)
      .items_center()
      .cursor_pointer()
      .border_l(2)
      .border_color(picked ? t.accent : alpha(t.accent, "00"))
      .when(current && !picked, (e) => e.bg(alpha(t.accent, "26")))
      .when(picked, (e) => e.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .child(this.graph(row, t))
      .children(c.refs.slice(0, 3).map((r) => this.chip(r, t)))
      .when(c.refs.length > 3, (e) =>
        e.child(
          div()
            .flex_none()
            .text_size(12)
            .text_color(t.dim)
            .child(`+${c.refs.length - 3}`),
        ),
      )
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .text_color(miss ? t.dim : merge && !picked ? t.muted : t.foreground)
          .child(c.subject),
      )
      .when(this.wide, (e) =>
        e.child(div().w(60).flex_none().font_family(this.mono).text_size(12).text_color(t.dim).child(c.short)).child(
          div()
            .w(130)
            .flex_none()
            .truncate()
            .text_size(13)
            .text_color(miss ? t.dim : t.muted)
            .child(c.author),
        ),
      )
      .child(
        div()
          .w(this.wide ? 105 : 70)
          .flex_none()
          .truncate()
          .text_size(13)
          .text_color(t.dim)
          .child(this.wide ? c.when : c.short),
      );
  }

  render(cx) {
    if (this.ctx() !== this.context) this.refresh(cx);
    /** @type {any} theme colors are plain strings; the element API types its color arguments as hex templates */
    const t = theme(),
      mono = settings().font_family ?? "JetBrains Mono";
    const off = !this.root || Boolean(this.busy),
      s = this.sync,
      graph = this.tab === "graph";
    this.mono = String(mono);
    this.hits();
    const branchLabel = this.branch ?? (this.root ? "HEAD detached" : "—");
    return (
      v_flex()
        .id("git-graph")
        .size_full()
        .min_h(0)
        .relative()
        .rounded(10)
        .overflow_hidden()
        .bg(t.background)
        .border_1()
        .border_color(t.border)
        .text_color(t.foreground)
        .text_size(14)
        .on_size_change((size, cx) => {
          const wide = size.width > 560,
            roomy = size.width > 820;
          if (wide !== this.wide || roomy !== this.roomy) {
            this.wide = wide;
            this.roomy = roomy;
            cx.notify();
          }
        })
        .child(
          h_flex()
            .h(46)
            .flex_none()
            .px(14)
            .gap(8)
            .items_center()
            .border_b(1)
            .border_color(t.border)
            .child(
              h_flex()
                .h_full()
                .gap(2)
                .child(this.tabButton("gg-tab-graph", "Graph", "graph", t))
                .child(this.tabButton("gg-tab-refs", "Refs", "refs", t))
                .child(this.tabButton("gg-tab-prs", "Pull requests", "prs", t))
                .child(this.tabButton("gg-tab-config", "Config", "config", t)),
            ),
        )
        // The controls of the shown tab sit on their own row under the tabs.
        .child(
          h_flex()
            .h(46)
            .flex_none()
            .px(14)
            .gap(8)
            .items_center()
            .border_b(1)
            .border_color(t.border)
            .when(graph, (e) =>
              e
                .child(
                  this.button(
                    "gg-branch",
                    [div().max_w(220).truncate().child(branchLabel), div().text_size(11).child("▾")],
                    (cx) => this.openMenu(cx),
                    t,
                    { disabled: !this.root, tone: t.accent, icon: "branch" },
                  ).max_w(300),
                )
                .when(Boolean(s?.behind), (e2) => e2.child(this.pill(`↓${s.behind}`, t.ansi3)))
                .when(Boolean(s?.ahead), (e2) => e2.child(this.pill(`↑${s.ahead}`, t.ansi2)))
                .when(Boolean(this.work?.changed), (e2) => e2.child(this.pill(`${this.work.changed} changed`, t.ansi3)))
                .when(Boolean(this.work?.conflicts), (e2) =>
                  e2.child(
                    this.pill(`${this.work.conflicts} conflict${this.work.conflicts === 1 ? "" : "s"}`, t.ansi1),
                  ),
                )
                .when(this.roomy, (e2) => e2.child(this.searchBox(t)))
                .child(div().flex_1())
                .child(this.button("gg-fetch", "Fetch", (cx) => this.fetch(cx), t, { disabled: off, icon: "fetch" }))
                .child(
                  this.button("gg-pull", s?.behind ? `Pull ↓${s.behind}` : "Pull", (cx) => this.pull(cx), t, {
                    disabled: off || !this.branch,
                    icon: "pull",
                  }),
                )
                .child(
                  this.button(
                    "gg-push",
                    this.armed === "push"
                      ? `Click again to push${s?.ahead ? ` ↑${s.ahead}` : ""}`
                      : s?.ahead
                        ? `Push ↑${s.ahead}`
                        : "Push",
                    (cx) => this.push(cx),
                    t,
                    { disabled: off || !this.branch, tone: this.armed === "push" ? t.ansi1 : null, icon: "push" },
                  ),
                ),
            )
            .when(this.tab === "prs", (e) => e.children(prToolbar(this, t)))
            .when(this.tab === "refs", (e) => e.children(refsToolbar(this, t)))
            .when(this.tab === "config", (e) => e.children(configToolbar(this, t))),
        )
        .when(Boolean(this.busy || this.note), (e) =>
          e.child(
            h_flex()
              .id("gg-note")
              .min_h(30)
              .flex_none()
              .px(14)
              .py(5)
              .items_center()
              .border_b(1)
              .border_color(t.border)
              .relative()
              .bg(this.busy ? t.raised : alpha(this.note.ok ? t.ansi2 : t.ansi1, "14"))
              .text_size(13)
              .text_color(this.busy ? t.muted : this.note.ok ? t.ansi2 : t.ansi1)
              .on_click((_e, cx) => {
                if (!this.busy) {
                  this.note = null;
                  cx.notify();
                }
              })
              .child(
                div()
                  .absolute()
                  .left(0)
                  .top(0)
                  .w(3)
                  .h_full()
                  .bg(this.busy ? t.accent : this.note.ok ? t.ansi2 : t.ansi1),
              )
              .child(
                div()
                  .flex_1()
                  .min_w(0)
                  .child(this.busy ? `${this.busy}…` : this.note.text),
              ),
          ),
        )
        .when(graph && Boolean(this.inprog), (e) =>
          e.child(
            h_flex()
              .id("gg-progress")
              .min_h(30)
              .flex_none()
              .px(14)
              .py(5)
              .gap(8)
              .items_center()
              .border_b(1)
              .border_color(t.border)
              .bg(alpha(t.ansi3, "18"))
              .text_size(13)
              .text_color(t.ansi3)
              .child(div().flex_none().font_semibold().child(this.inprog))
              .child(
                div()
                  .flex_1()
                  .min_w(0)
                  .truncate()
                  .text_color(t.muted)
                  .child(
                    this.work?.conflicts
                      ? `${this.work.conflicts} file${this.work.conflicts === 1 ? "" : "s"} with conflicts. Resolve it in a terminal${ABORT[this.inprog] ? ", or abort it (that discards the work on it so far)" : ", or run git am --abort"}.`
                      : `In progress. Finish it in a terminal${ABORT[this.inprog] ? ", or abort it (that discards the work on it so far)" : ", or run git am --abort"}.`,
                  ),
              )
              .when(Boolean(ABORT[this.inprog]), (e2) =>
                e2.child(
                  this.small(
                    "gg-abort",
                    this.armed === `abort:${this.inprog}`
                      ? `Click again to abort the ${ABORT[this.inprog]}`
                      : `Abort ${ABORT[this.inprog]}`,
                    (cx) => {
                      if (!this.blocked()) this.abort(cx);
                    },
                    t,
                    this.armed === `abort:${this.inprog}` ? t.ansi1 : null,
                  ),
                ),
              ),
          ),
        )
        .when(graph, (e) =>
          e.child(
            div()
              .flex_1()
              .min_h(0)
              .relative()
              .child(
                v_virtual_list(
                  "gg-list",
                  this.rows.length,
                  ROW,
                  (i) => this.rows[i].c.hash,
                  (range) => this.rows.slice(range.start, range.end).map((row) => this.row(row, t)),
                )
                  .track_scroll(this.scroll)
                  .size_full()
                  .on_item_click((hash, cx) => {
                    if (!this.blocked()) this.select(hash, cx);
                  }),
              )
              .child(Scrollbar.vertical("gg-list").viewport_from_layout().absolute().inset_0())
              .when(!this.rows.length, (e2) =>
                e2.child(this.emptyState(this.error || (this.loading ? "Loading history…" : "No commits"), t.dim, t)),
              ),
          ),
        )
        .when(this.tab === "prs", (e) => e.child(prPanel(this, t, mono)))
        .when(this.tab === "refs", (e) => e.child(refsPanel(this, t, mono)))
        .when(this.tab === "config", (e) => e.child(configPanel(this, t, mono)))
        .when(graph && this.more, (e) =>
          e.child(
            h_flex()
              .h(44)
              .flex_none()
              .px(14)
              .gap(10)
              .items_center()
              .border_t(1)
              .border_color(t.border)
              .child(div().text_size(12).text_color(t.dim).child(`Showing ${this.rows.length} commits`))
              .child(div().flex_1())
              .child(
                this.button("gg-more", "Load more", (cx) => this.loadMore(cx), t, {
                  disabled: Boolean(this.loading),
                  icon: "more",
                }),
              ),
          ),
        )
        .when(graph && Boolean(this.sel), (e) => e.child(this.detailPanel(t, mono)))
        .when(graph && this.menu, (e) => e.child(this.menuPanel(t)))
    );
  }
}
