import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list } from "gpui-base";
import { spaces, panes, focused, exec, watchFolder, theme, settings, props } from "herdr";
import { loadPrs, prPanel, prToolbar, resetPrs } from "./prs.js";
import { initConfig, loadConfig, configPanel, configToolbar, resetConfig } from "./config.js";

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
const TABS = ["graph", "prs", "config"];
let LAST_TAB = "graph"; // reopening the mod returns to the tab it was closed on
const CACHED = ["root", "on", "rows", "lanes", "more", "branch", "sync", "upstreamGone", "signature", "limit"];

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
    this.branch = null;
    this.sync = null;
    this.busy = null;
    this.note = null;
    this.armed = false;
    this.menu = false;
    this.guard = 0;
    this.branches = [];
    this.filter = "";
    this.tab = TABS.includes(props()?.tab) ? props().tab : LAST_TAB;
    this.prState = ["open", "merged", "closed"].includes(props()?.state) ? props().state : "open";
    this.prLoading = false;
    resetPrs(this);
    initConfig(this);
    const raw = props()?.pr,
      want = typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw)) ? Number(raw) : NaN;
    this.prWant = Number.isSafeInteger(want) && want > 0 ? want : null;
    this.input = InputState.new({ placeholder: "Find or create a branch" });
    this.input.on("change", (_e, cx) => {
      this.filter = this.input.value().trim();
      cx.notify();
    });
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
      this.menu = false;
      this.note = null;
      this.armed = false;
      resetPrs(this);
      resetConfig(this);
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
        const [refs, head, sym, ab] = await Promise.all([
          git(["for-each-ref", "--format=%(objectname) %(refname)"]),
          git(["rev-parse", "HEAD"]),
          git(["symbolic-ref", "--short", "-q", "HEAD"]),
          git(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]),
        ]);
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
        if (this.sel && !commits.some((c) => c.hash === this.sel)) this.clearSel();
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
      }
    });
  }

  setTab(tab, cx) {
    if (this.tab === tab) return;
    this.tab = LAST_TAB = tab;
    this.menu = false;
    if (tab === "prs") loadPrs(this, cx);
    if (tab === "config") loadConfig(this, cx);
    cx.notify();
  }

  loadMore(cx) {
    this.limit += PAGE;
    this.refresh(cx, true);
  }

  // Runs one git command the user asked for (fetch, pull, push, switch). One at a time; the
  // outcome shows in the note bar, and the graph reloads afterwards.
  op(label, args, cx, cmd = "git") {
    if (this.busy || !this.root) return;
    this.busy = label;
    this.note = null;
    this.armed = false;
    const context = this.context,
      root = this.root,
      on = this.on;
    cx.spawn(async (cx) => {
      let ok = false;
      try {
        const r = await exec(cmd, args, { cwd: root, on, timeout: 120000 });
        if (this.context !== context) return;
        ok = r.code === 0;
        const out = `${r.stderr}\n${r.stdout}`.trim();
        this.note = {
          ok,
          text: ok ? `${label}: done` : out.split("\n").slice(-4).join("\n") || `${label} failed (exit ${r.code})`,
        };
      } catch (e) {
        this.note = { ok: false, text: `${label} failed: ${e}` };
      } finally {
        this.busy = null;
        this.signature = null;
        if (ok)
          cx.timer.after(5000, (cx) => {
            if (this.note?.ok) {
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
    if (!this.armed) {
      this.armed = true;
      cx.timer.after(5000, (cx) => {
        if (this.armed) {
          this.armed = false;
          cx.notify();
        }
      });
      cx.notify();
      return;
    }
    this.op("Push", this.sync ? ["push"] : ["push", "-u", "origin", "HEAD"], cx);
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
    const valid =
      /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(this.filter) &&
      !this.filter.includes("..") &&
      !this.filter.endsWith("/") &&
      !this.filter.endsWith(".lock");
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
          .child(b.kind === "new" ? `Create branch "${b.name}"` : b.name),
      )
      .when(b.kind === "remote", (e) => e.child(div().flex_none().text_size(12).text_color(t.ansi4).child("remote")));
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
    this.files = [];
    this.openFile = null;
    this.setDiff([]);
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
          git(["show", "-s", "--no-color", "--date=format:%Y-%m-%d %H:%M", "--format=%an%n%ad%n%n%B", hash]),
          git(["show", "--format=", "--numstat", "-z", "--no-renames", "-m", "--first-parent", hash]),
          git(["show", "--format=", "--name-status", "-z", "--no-renames", "-m", "--first-parent", hash]),
        ]);
        if (!same()) return;
        if (info.code !== 0) throw new Error(info.stderr);
        this.detail = info.stdout.replace(/\n+$/, "").split("\n").slice(0, 60);
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

  // A small bordered button for the detail panels (no icon, never blocked by the branch menu).
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
  detailPanel(t, mono) {
    const c = this.rows.find((r) => r.c.hash === this.sel)?.c;
    const btn = (id, label, fn) => this.small(id, label, fn, t);
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
          .child(div().flex_1())
          .child(
            btn("gg-close", "Close", (cx) => {
              this.clearSel();
              cx.notify();
            }),
          ),
      );
    // detail is [author, date, "", subject, ...body]: author and date share one muted line and the
    // subject is set apart from the body. Loading and error text (one line) is shown as is.
    /** @type {{ text: string, tone?: any, gap?: boolean, bold?: boolean }[]} */
    const message =
      this.detail?.length >= 2
        ? [
            { text: `${this.detail[0]} · ${this.detail[1]}`, tone: t.muted },
            { text: "", gap: true },
            ...this.detail.slice(3).map((text, i) => ({ text, tone: t.foreground, bold: i === 0 })),
          ]
        : [{ text: this.detail?.[0] ?? "Loading…", tone: t.muted }];
    const body = this.openFile
      ? this.diffView(t, mono)
      : v_flex()
          .id("gg-detail")
          .flex_1()
          .min_h(0)
          .overflow_y_scroll()
          .p(10)
          .gap(1)
          .font_family(mono)
          .text_size(13)
          .children(
            message.map((l) =>
              l.gap
                ? div().h(6).flex_none()
                : div()
                    .min_h(18)
                    .text_color(l.tone)
                    .when(l.bold, (e) => e.font_semibold())
                    .child(l.text || " "),
            ),
          )
          .child(div().h(8).flex_none())
          .children(
            this.files.map((f) =>
              h_flex()
                .id(`gg-f-${f.path}`)
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
                  div()
                    .w(12)
                    .text_color(f.status === "A" ? t.ansi2 : f.status === "D" ? t.ansi1 : t.blocked)
                    .child(f.status),
                )
                .child(div().flex_1().min_w(0).truncate().child(f.path))
                .when(f.add > 0, (e) => e.child(div().text_color(t.ansi2).child(`+${f.add}`)))
                .when(f.del > 0, (e) => e.child(div().text_color(t.ansi1).child(`−${f.del}`))),
            ),
          );
    return v_flex().h(340).flex_none().border_t(1).border_color(t.border).child(head).child(body);
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
    if (lane < MAX_LANES) {
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
    return div()
      .flex_none()
      .max_w(140)
      .h(20)
      .px(6)
      .flex()
      .items_center()
      .rounded(4)
      .border_1()
      .border_color(c)
      .text_color(c)
      .text_size(12)
      .truncate()
      .child(ref.name);
  }

  row(row, t) {
    const c = row.c,
      picked = this.sel === c.hash;
    // No handlers in a virtual list's renderer: clicks come from on_item_click on the list.
    return h_flex()
      .w_full()
      .h(ROW)
      .flex_none()
      .pr(10)
      .gap(6)
      .items_center()
      .cursor_pointer()
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
      .child(div().flex_1().min_w(0).truncate().child(c.subject))
      .when(this.wide, (e) =>
        e.child(div().w(130).flex_none().truncate().text_size(13).text_color(t.muted).child(c.author)),
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
          const wide = size.width > 560;
          if (wide !== this.wide) {
            this.wide = wide;
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
                .when(Boolean(s?.behind), (e2) =>
                  e2.child(div().text_size(12).text_color(t.ansi3).child(`↓${s.behind}`)),
                )
                .when(Boolean(s?.ahead), (e2) => e2.child(div().text_size(12).text_color(t.ansi2).child(`↑${s.ahead}`)))
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
                    this.armed
                      ? `Click again to push${s?.ahead ? ` ↑${s.ahead}` : ""}`
                      : s?.ahead
                        ? `Push ↑${s.ahead}`
                        : "Push",
                    (cx) => this.push(cx),
                    t,
                    { disabled: off || !this.branch, tone: this.armed ? t.ansi1 : null, icon: "push" },
                  ),
                ),
            )
            .when(this.tab === "prs", (e) => e.children(prToolbar(this, t)))
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
              .bg(t.raised)
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
                  .flex_1()
                  .min_w(0)
                  .child(this.busy ? `${this.busy}…` : this.note.text),
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
