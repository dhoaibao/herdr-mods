// The commit detail panel of the Graph tab: selecting a commit, its message and files, and the actions on it.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec } from "herdr";
import { READ, alpha } from "./shared.js";
import { small, field } from "./ui.js";
import { pickFile, setDiff, diffView } from "./diff.js";
import { createRef, pickCommit, pickKey, detachHead } from "./writes.js";
import { toggleHistory, fileHistoryView } from "./history.js";

export function clearSel(v) {
  v.sel = null;
  v.detail = null;
  v.meta = null;
  v.files = [];
  v.openFile = null;
  v.fileHist = null;
  v.refsStash = null;
  setDiff(v, []);
  // A pending Pop, Drop, Cherry-pick or Revert belongs to the item that was open.
  if (/^(pop|drop|cherry-pick|revert):/.test(v.armed ?? "")) v.armed = null;
}

export function selectCommit(v, hash, cx) {
  if (v.sel === hash) {
    clearSel(v);
    cx.notify();
    return;
  }
  clearSel(v);
  v.sel = hash;
  const context = v.context,
    root = v.root,
    on = v.on;
  const git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
  const same = () => v.sel === hash && v.context === context;
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
      v.meta = { email, committer, committerEmail };
      v.detail = [author, ...rest];
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
      v.files = files;
    } catch (e) {
      if (same()) v.detail = [String(e)];
    }
    cx.notify();
  });
  cx.notify();
}

export function copyHash(v, hash, cx) {
  cx.write_to_clipboard(hash);
  const mine = (v.note = { ok: true, text: `Copied ${hash.slice(0, 7)}` });
  cx.timer.after(3000, (cx) => {
    // Only this click's own note: a later Copy has its own timer, and any other note must stay.
    if (v.note === mine) {
      v.note = null;
      cx.notify();
    }
  });
  cx.notify();
}

// Selects a commit that is already in the loaded graph and scrolls its row to the middle.
export function jumpTo(v, hash, cx) {
  const at = v.rows.findIndex((r) => r.c.hash === hash);
  if (at < 0) {
    v.note = { ok: false, text: `${hash.slice(0, 7)} is not in the loaded graph. Load more commits to reach it.` };
    cx.notify();
    return;
  }
  if (v.sel !== hash) selectCommit(v, hash, cx);
  v.scroll.scroll_to_item(at, "center");
}

// The buttons that write ignore a click that only dismissed the branch menu.
const guarded = (v, fn) => (cx) => {
  if (!v.blocked()) fn(cx);
};

// The header row: the open commit's summary and Close, or the open file's name and Back.
function detailHead(v, t, mono, c) {
  const btn = (id, label, fn, icon) => small(v, id, label, fn, t, null, { icon });
  const history = v.tab === "graph" && Boolean(c);
  const pickBtn = (id, kind, label, icon) => {
    const armed = v.armed === pickKey(kind, c, v.branch);
    return small(
      v,
      id,
      armed ? `Click again to ${label.toLowerCase()}` : label,
      guarded(v, (cx) => pickCommit(v, kind, cx)),
      t,
      armed ? t.ansi1 : null,
      { icon },
    );
  };
  return h_flex()
    .h(40)
    .flex_none()
    .px(12)
    .gap(8)
    .items_center()
    .border_b(1)
    .border_color(t.border)
    .when(v.openFile, (e) =>
      e
        .child(
          btn(
            "gg-back",
            "Files",
            (cx) => {
              v.openFile = null;
              v.fileHist = null;
              setDiff(v, []);
              cx.notify();
            },
            "back",
          ),
        )
        .child(div().flex_1().min_w(0).truncate().font_family(mono).text_size(13).child(v.openFile))
        .when(v.tab === "graph", (e2) =>
          e2.child(
            btn(
              "gg-hist",
              v.fileHist ? "Diff" : "History",
              guarded(v, (cx) => toggleHistory(v, cx)),
              v.fileHist ? "diff" : "history",
            ),
          ),
        ),
    )
    .when(!v.openFile, (e) =>
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
            .child(`${v.files.length} file${v.files.length === 1 ? "" : "s"} changed`),
        )
        .when(
          v.files.some((f) => f.add || f.del),
          (e2) =>
            e2
              .child(
                div()
                  .text_size(13)
                  .text_color(t.ansi2)
                  .child(`+${v.files.reduce((n, f) => n + f.add, 0)}`),
              )
              .child(
                div()
                  .text_size(13)
                  .text_color(t.ansi1)
                  .child(`−${v.files.reduce((n, f) => n + f.del, 0)}`),
              ),
        )
        .child(div().flex_1())
        .when(history, (e2) =>
          e2
            .child(pickBtn("gg-cherry", "cherry-pick", "Cherry-pick", "cherry"))
            .child(pickBtn("gg-revert", "revert", "Revert", "undo")),
        )
        .child(
          btn(
            "gg-close",
            "Close",
            (cx) => {
              clearSel(v);
              cx.notify();
            },
            "close",
          ),
        ),
    );
}

// The commit message block: subject, author and date, hash with Copy, parents, and the body.
// detail is [author, date, "", subject, ...body]: author and date share one muted line and the
// subject is set apart from the body. Loading and error text (one line) is shown as is.
function detailMessage(v, t, mono, c) {
  const loaded = v.detail?.length >= 2;
  const lines = loaded ? v.detail.slice(3) : [];
  while (lines.length && !lines[0].trim()) lines.shift();
  // Shown only when the committer differs from the author (a rebase, cherry-pick or applied patch).
  const m = v.meta,
    committed =
      loaded && m && (m.committer !== v.detail[0] || m.committerEmail !== m.email)
        ? `${m.committer}${m.committerEmail ? ` <${m.committerEmail}>` : ""}`
        : "";
  return loaded
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
          .child(`${v.detail[0]}${v.meta?.email ? ` <${v.meta.email}>` : ""} · ${v.detail[1]}`),
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
          .child(small(v, "gg-copy", "Copy", (cx) => copyHash(v, c.hash, cx), t, null, { icon: "copy" })),
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
                      .on_click((_e, cx) => jumpTo(v, p, cx))
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
          .child(v.detail?.[0] ?? "Loading…"),
      ];
}

// One changed file: status badge, name with its directory muted, and the line counts.
function fileRow(v, f, t, mono) {
  const color = f.status === "A" ? t.ansi2 : f.status === "D" ? t.ansi1 : t.ansi3;
  // The file name stands out; its directory is muted so long paths stay scannable.
  const cut = f.path.lastIndexOf("/");
  return h_flex()
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
    .on_click((_e, cx) => pickFile(v, f.path, cx))
    .child(
      div()
        .w(18)
        .h(18)
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(4)
        .bg(alpha(color, "22"))
        .text_size(12)
        .text_color(color)
        .child(f.status),
    )
    .child(
      h_flex()
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
        ),
    )
    .when(f.add > 0, (e) => e.child(div().text_color(t.ansi2).child(`+${f.add}`)))
    .when(f.del > 0, (e) => e.child(div().text_color(t.ansi1).child(`−${f.del}`)));
}

// The body under the header: a file's history or diff once a file is open, else the message and the file list.
function detailBody(v, t, mono, c) {
  if (v.openFile) return v.fileHist ? fileHistoryView(v, t, mono) : diffView(v, t, mono);
  return v_flex()
    .id("gg-detail")
    .flex_1()
    .min_h(0)
    .overflow_y_scroll()
    .px(14)
    .py(12)
    .gap(1)
    .text_size(13)
    .children(detailMessage(v, t, mono, c))
    .child(div().h(10).flex_none())
    .children(v.files.map((f) => fileRow(v, f, t, mono)));
}

// Branch, tag or detached checkout at this commit; only for a graph commit (not a stash).
function detailActions(v, t, c) {
  const btn = (id, label, fn, icon) => small(v, id, label, fn, t, null, { icon });
  return v.tab === "graph" && !v.openFile && c
    ? h_flex()
        .h(44)
        .flex_none()
        .px(12)
        .gap(8)
        .items_center()
        .border_b(1)
        .border_color(t.border)
        .child(field(v, "gg-ref-name", v.refName, t).w(170))
        .child(field(v, "gg-ref-msg", v.refMsg, t).flex_1().min_w(0))
        .child(
          btn(
            "gg-branch-here",
            "Branch here",
            guarded(v, (cx) => createRef(v, "branch", cx)),
            "branch-plus",
          ),
        )
        .child(
          btn(
            "gg-tag-here",
            "Tag here",
            guarded(v, (cx) => createRef(v, "tag", cx)),
            "tag",
          ),
        )
        .child(
          btn(
            "gg-detach",
            "Check out (detached)",
            guarded(v, (cx) => detachHead(v, cx)),
            "checkout",
          ),
        )
    : null;
}

// The selected commit: its message and changed files, or one file's diff.
// `c` is the commit shown; the Refs tab passes a stash (a commit the graph log does not list).
export function detailPanel(v, t, mono, c = v.rows.find((r) => r.c.hash === v.sel)?.c) {
  const actions = detailActions(v, t, c);
  return v_flex()
    .h(340)
    .flex_none()
    .border_t(1)
    .border_color(t.border)
    .child(detailHead(v, t, mono, c))
    .when(Boolean(actions), (e) => e.child(actions))
    .child(detailBody(v, t, mono, c));
}
