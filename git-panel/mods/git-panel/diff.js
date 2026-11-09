// The file diff of the commit detail panel: loading it, marking changed words, and the row renderer.
import { div } from "gpui-kit";
import { h_flex, Scrollbar, v_virtual_list } from "gpui-base";
import { exec } from "herdr";
import { READ, alpha } from "./shared.js";

export function pickFile(v, path, cx) {
  v.openFile = path;
  v.fileHist = null;
  setDiff(v, ["Loading…"]);
  const hash = v.sel,
    context = v.context,
    root = v.root,
    on = v.on;
  const same = () => v.sel === hash && v.openFile === path && v.context === context;
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
      setDiff(
        v,
        lines.slice(0, 2000).map((l) => (l.length > 4000 ? l.slice(0, 4000) + "… (line truncated)" : l)),
      );
    cx.notify();
  });
  cx.notify();
}

export function setDiff(v, lines) {
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
    for (let k = 0; k < Math.min(b - a, i - b); k++) markWords(v, rows[a + k], rows[b + k]);
  }
  v.diff = rows;
  v.diffWidth = Math.max(300, ...lines.map((l) => l.length * 8 + 120));
}

export function markWords(v, del, add) {
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

export function diffRow(v, row, t) {
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

// The parsed diff in `v.diff`: scrolls both ways, one line per row.
export function diffView(v, t, mono) {
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
            .min_w(v.diffWidth)
            .h_full()
            .child(
              v_virtual_list(
                "gg-diff",
                v.diff.length,
                22,
                (i) => String(i),
                (range) => v.diff.slice(range.start, range.end).map((row) => diffRow(v, row, t)),
              ).size_full(),
            ),
        ),
    )
    .child(Scrollbar.vertical("gg-diff").viewport_from_layout().absolute().inset_0());
}
