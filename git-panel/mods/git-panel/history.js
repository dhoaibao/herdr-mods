// File history for the commit detail panel of the Git Panel mod: the commits that touched one file,
// from the open commit back (`git log --follow`), shown in place of that file's diff; a click jumps to
// the commit in the graph.
// Read-only. Functions take the GitPanel view as `v` and keep their state on it as `v.fileHist`.
import { div } from "gpui-kit";
import { h_flex, Scrollbar, v_flex, v_virtual_list } from "gpui-base";
import { exec } from "herdr";

const ROW = 28;
// The same read-only flags as shared.js: no index refresh or lock, so our own folder watch never fires.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const LIMIT = 100;

/**
 * Parses `log --format=%H%x1f%an%x1f%ar%x1f%s` output.
 * @param {string} text
 */
export function parseHistory(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, author, when, subject] = line.split("\x1f");
      return { hash, short: (hash ?? "").slice(0, 7), author: author ?? "", when: when ?? "", subject: subject ?? "" };
    });
}

// Shows the history of the file open in the detail panel, or goes back to its diff.
export function toggleHistory(v, cx) {
  if (v.fileHist) {
    v.fileHist = null;
    cx.notify();
    return;
  }
  const path = v.openFile,
    rev = v.sel;
  // The history starts at the open commit, not at HEAD, so a commit from another branch lists itself.
  if (!path || !v.root || !rev || !/^[0-9a-f]{40,64}$/.test(rev)) return;
  const context = v.context,
    root = v.root,
    on = v.on;
  // The object itself is the identity of this read: closing the panel or opening another file replaces it.
  const hist = { path, rows: [], loading: true, error: null };
  v.fileHist = hist;
  const same = () => v.fileHist === hist && v.context === context;
  cx.spawn(async (cx) => {
    try {
      const r = await exec(
        "git",
        // --literal-pathspecs: a file name is a name, never `:(magic)` or a glob.
        [
          ...READ,
          "--literal-pathspecs",
          "log",
          "--follow",
          "-n",
          String(LIMIT),
          "--no-color",
          "--format=%H%x1f%an%x1f%ar%x1f%s",
          rev,
          "--",
          path,
        ],
        { cwd: root, on, timeout: 30000 },
      );
      if (!same()) return;
      if (r.code !== 0)
        throw new Error(r.stderr.trim().split("\n").slice(-2).join("\n") || `git exited with ${r.code}`);
      hist.rows = parseHistory(r.stdout);
    } catch (e) {
      if (same()) hist.error = String(e?.message ?? e);
    }
    if (same()) {
      hist.loading = false;
      cx.notify();
    }
  });
  cx.notify();
}

function historyRow(v, c, t, mono) {
  const picked = v.sel === c.hash;
  return h_flex()
    .w_full()
    .h(ROW)
    .flex_none()
    .px(14)
    .gap(10)
    .items_center()
    .cursor_pointer()
    .when(picked, (e) => e.bg(t.selected))
    .hover((s) => s.bg(t.hover))
    .child(div().w(60).flex_none().font_family(mono).text_size(12).text_color(t.accent).child(c.short))
    .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(c.subject))
    .when(v.wide, (e) => e.child(div().w(120).flex_none().truncate().text_size(13).text_color(t.muted).child(c.author)))
    .child(div().w(100).flex_none().truncate().text_size(12).text_color(t.dim).child(c.when));
}

// The panel body while a file's history is shown.
export function fileHistoryView(v, t, mono) {
  const h = v.fileHist;
  const rows = h?.rows ?? [];
  const note = h?.error
    ? h.error
    : h?.loading
      ? "Loading…"
      : !rows.length
        ? "No commits found for this file"
        : `${rows.length}${rows.length >= LIMIT ? "+" : ""} commit${rows.length === 1 ? "" : "s"} touched it up to this commit (renames followed). Click one to jump to it.`;
  return v_flex()
    .flex_1()
    .min_h(0)
    .child(
      div()
        .h(30)
        .flex_none()
        .px(14)
        .flex()
        .items_center()
        .border_b(1)
        .border_color(t.border)
        .text_size(12)
        .text_color(h?.error ? t.ansi1 : t.dim)
        .child(note),
    )
    .child(
      div()
        .flex_1()
        .min_h(0)
        .relative()
        .child(
          v_virtual_list(
            "gg-fhist",
            rows.length,
            ROW,
            (i) => rows[i].hash,
            (range) => rows.slice(range.start, range.end).map((c) => historyRow(v, c, t, mono)),
          )
            .size_full()
            .on_item_click((hash, cx) => {
              if (v.blocked()) return;
              // The commit already open: back to the file's diff. Another one: select it in the graph.
              if (hash === v.sel) {
                v.fileHist = null;
                cx.notify();
              } else v.jumpTo(hash, cx);
            }),
        )
        .child(Scrollbar.vertical("gg-fhist").viewport_from_layout().absolute().inset_0()),
    );
}
