// One row of the commit list: the lane drawing, the ref chips and the commit text.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { ROW, LANE, MAX_LANES, alpha } from "./shared.js";

export function drawLanes(v, row, t) {
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
    .w(v.lanes * LANE + 10)
    .h(ROW)
    .children(out);
}

export function refChip(v, ref, t) {
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

export function commitRow(v, row, t) {
  const c = row.c,
    picked = v.sel === c.hash;
  // With a search, rows that do not match are dimmed (not removed, so the lanes stay intact) and
  // the match the list last moved to is tinted.
  const miss = Boolean(v.hitQuery) && !v.hitSet.has(c.hash),
    current = c.hash === v.curHit;
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
    .child(drawLanes(v, row, t))
    .children(c.refs.slice(0, 3).map((r) => refChip(v, r, t)))
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
    .when(v.wide, (e) =>
      e.child(div().w(60).flex_none().font_family(v.mono).text_size(12).text_color(t.dim).child(c.short)).child(
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
        .w(v.wide ? 105 : 70)
        .flex_none()
        .truncate()
        .text_size(13)
        .text_color(t.dim)
        .child(v.wide ? c.when : c.short),
    );
}
