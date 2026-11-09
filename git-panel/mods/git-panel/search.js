// Commit search of the Graph tab: the matching rows, stepping through them, and the search box.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { matches } from "./log.js";
import { small, field } from "./ui.js";

// The rows that match the search, recomputed only when the rows or the text changed. While the
// box is hidden (a narrow overlay) the search counts as empty, so no row stays dimmed unexplained;
// hitQuery is the text actually applied.
export function hits(v) {
  const q = v.roomy ? v.search : "";
  if (v.hitRows === v.rows && v.hitQuery === q) return;
  v.hitRows = v.rows;
  v.hitQuery = q;
  v.hitList = [];
  v.hitSet = new Set();
  if (q) {
    v.rows.forEach((r, i) => {
      if (matches(r.c, q)) {
        v.hitList.push(i);
        v.hitSet.add(r.c.hash);
      }
    });
  }
  if (v.curHit && !v.hitSet.has(v.curHit)) v.curHit = null;
}

export function goHit(v, i, cx) {
  const at = v.hitList[i];
  v.curHit = v.rows[at].c.hash;
  v.scroll.scroll_to_item(at, "center");
  cx.notify();
}

export function nextHit(v, step, cx) {
  hits(v);
  const n = v.hitList.length;
  if (!n) return;
  const cur = v.hitList.findIndex((at) => v.rows[at].c.hash === v.curHit);
  goHit(v, cur < 0 ? (step > 0 ? 0 : n - 1) : (cur + step + n) % n, cx);
}

// The search box with its match count and step buttons.
export function searchBox(v, t) {
  const n = v.hitList.length,
    at = v.hitList.findIndex((i) => v.rows[i].c.hash === v.curHit);
  return h_flex()
    .flex_none()
    .gap(8)
    .items_center()
    .child(field(v, "gg-search", v.searchInput, t).w(200))
    .when(Boolean(v.search), (e) =>
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
              : v.more
                ? "No match in loaded commits"
                : "No match",
          ),
      ),
    )
    .when(n > 1, (e) =>
      e
        // Like the toolbar buttons, ignore a click that only dismissed the branch menu.
        .child(small(v, "gg-hit-prev", "↑", (cx) => !v.blocked() && nextHit(v, -1, cx), t))
        .child(small(v, "gg-hit-next", "↓", (cx) => !v.blocked() && nextHit(v, 1, cx), t)),
    );
}
