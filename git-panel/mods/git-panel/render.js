// The view's render: tabs, the toolbar of the shown tab, the note and banner bars, and the panels.
import { div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list } from "gpui-base";
import { theme, settings } from "herdr";
import { prChip, prPanel, prToolbar } from "./prs.js";
import { configPanel, configToolbar } from "./config.js";
import { refsPanel, refsToolbar } from "./refs.js";
import { ROW, ABORT, alpha } from "./shared.js";
import { button, emptyState, pill, small, tabButton } from "./ui.js";
import { searchBox, hits } from "./search.js";
import { fetchAll, pull, push } from "./ops.js";
import { abortOp } from "./writes.js";
import { openMenu, menuPanel } from "./menu.js";
import { selectCommit, detailPanel } from "./detail.js";
import { commitRow } from "./graph.js";

// The tab strip.
function tabsRow(v, t) {
  return h_flex()
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
        .child(tabButton(v, "gg-tab-graph", "Graph", "graph", t))
        .child(tabButton(v, "gg-tab-refs", "Refs", "refs", t))
        .child(tabButton(v, "gg-tab-prs", "Pull requests", "prs", t))
        .child(tabButton(v, "gg-tab-config", "Config", "config", t)),
    );
}

// The Graph tab's controls: branch menu button, status pills, PR chip, search, fetch, pull and push.
function graphControls(v, t, e) {
  const off = !v.root || Boolean(v.busy),
    s = v.sync;
  const branchLabel = v.branch ?? (v.root ? "HEAD detached" : "—");
  return e
    .child(
      button(
        v,
        "gg-branch",
        [div().max_w(220).truncate().child(branchLabel), div().text_size(11).child("▾")],
        (cx) => openMenu(v, cx),
        t,
        { disabled: !v.root, tone: t.accent, icon: "branch" },
      ).max_w(300),
    )
    .when(Boolean(s?.behind), (e2) => e2.child(pill(v, `↓${s.behind}`, t.ansi3)))
    .when(Boolean(s?.ahead), (e2) => e2.child(pill(v, `↑${s.ahead}`, t.ansi2)))
    .when(Boolean(v.work?.changed), (e2) => e2.child(pill(v, `${v.work.changed} changed`, t.ansi3)))
    .when(Boolean(v.work?.conflicts), (e2) =>
      e2.child(pill(v, `${v.work.conflicts} conflict${v.work.conflicts === 1 ? "" : "s"}`, t.ansi1)),
    )
    .when(v.wide && Boolean(v.prHead) && v.prHead.branch === v.branch, (e2) => e2.child(prChip(v, t)))
    .when(v.roomy, (e2) => e2.child(searchBox(v, t)))
    .child(div().flex_1())
    .child(button(v, "gg-fetch", "Fetch", (cx) => fetchAll(v, cx), t, { disabled: off, icon: "fetch" }))
    .child(
      button(v, "gg-pull", s?.behind ? `Pull ↓${s.behind}` : "Pull", (cx) => pull(v, cx), t, {
        disabled: off || !v.branch,
        icon: "pull",
      }),
    )
    .child(
      button(
        v,
        "gg-push",
        v.armed === "push"
          ? `Click again to push${s?.ahead ? ` ↑${s.ahead}` : ""}`
          : s?.ahead
            ? `Push ↑${s.ahead}`
            : "Push",
        (cx) => push(v, cx),
        t,
        { disabled: off || !v.branch, tone: v.armed === "push" ? t.ansi1 : null, icon: "push" },
      ),
    );
}

// The controls of the shown tab sit on their own row under the tabs.
function toolbarRow(v, t) {
  return h_flex()
    .h(46)
    .flex_none()
    .px(14)
    .gap(8)
    .items_center()
    .border_b(1)
    .border_color(t.border)
    .when(v.tab === "graph", (e) => graphControls(v, t, e))
    .when(v.tab === "prs", (e) => e.children(prToolbar(v, t)))
    .when(v.tab === "refs", (e) => e.children(refsToolbar(v, t)))
    .when(v.tab === "config", (e) => e.children(configToolbar(v, t)));
}

// The running operation or its outcome; a click dismisses the outcome.
function noteBar(v, t) {
  return h_flex()
    .id("gg-note")
    .min_h(30)
    .flex_none()
    .px(14)
    .py(5)
    .items_center()
    .border_b(1)
    .border_color(t.border)
    .relative()
    .bg(v.busy ? t.raised : alpha(v.note.ok ? t.ansi2 : t.ansi1, "14"))
    .text_size(13)
    .text_color(v.busy ? t.muted : v.note.ok ? t.ansi2 : t.ansi1)
    .on_click((_e, cx) => {
      if (!v.busy) {
        v.note = null;
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
        .bg(v.busy ? t.accent : v.note.ok ? t.ansi2 : t.ansi1),
    )
    .child(
      div()
        .flex_1()
        .min_w(0)
        .child(v.busy ? `${v.busy}…` : v.note.text),
    );
}

// The banner for a merge, rebase, cherry-pick or revert in progress, with its Abort button.
function progressBanner(v, t) {
  return h_flex()
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
    .child(div().flex_none().font_semibold().child(v.inprog))
    .child(
      div()
        .flex_1()
        .min_w(0)
        .truncate()
        .text_color(t.muted)
        .child(
          v.work?.conflicts
            ? `${v.work.conflicts} file${v.work.conflicts === 1 ? "" : "s"} with conflicts. Resolve it in a terminal${ABORT[v.inprog] ? ", or abort it (that discards the work on it so far)" : ", or run git am --abort"}.`
            : `In progress. Finish it in a terminal${ABORT[v.inprog] ? ", or abort it (that discards the work on it so far)" : ", or run git am --abort"}.`,
        ),
    )
    .when(Boolean(ABORT[v.inprog]), (e2) =>
      e2.child(
        small(
          v,
          "gg-abort",
          v.armed === `abort:${v.inprog}` ? `Click again to abort the ${ABORT[v.inprog]}` : `Abort ${ABORT[v.inprog]}`,
          (cx) => {
            if (!v.blocked()) abortOp(v, cx);
          },
          t,
          v.armed === `abort:${v.inprog}` ? t.ansi1 : null,
        ),
      ),
    );
}

// The commit list of the Graph tab.
function commitList(v, t) {
  return div()
    .flex_1()
    .min_h(0)
    .relative()
    .child(
      v_virtual_list(
        "gg-list",
        v.rows.length,
        ROW,
        (i) => v.rows[i].c.hash,
        (range) => v.rows.slice(range.start, range.end).map((row) => commitRow(v, row, t)),
      )
        .track_scroll(v.scroll)
        .size_full()
        .on_item_click((hash, cx) => {
          if (!v.blocked()) selectCommit(v, hash, cx);
        }),
    )
    .child(Scrollbar.vertical("gg-list").viewport_from_layout().absolute().inset_0())
    .when(!v.rows.length, (e2) =>
      e2.child(emptyState(v, v.error || (v.loading ? "Loading history…" : "No commits"), t.dim, t)),
    );
}

// The footer under the list while more commits can be loaded.
function moreBar(v, t) {
  return h_flex()
    .h(44)
    .flex_none()
    .px(14)
    .gap(10)
    .items_center()
    .border_t(1)
    .border_color(t.border)
    .child(div().text_size(12).text_color(t.dim).child(`Showing ${v.rows.length} commits`))
    .child(div().flex_1())
    .child(
      button(v, "gg-more", "Load more", (cx) => v.loadMore(cx), t, {
        disabled: Boolean(v.loading),
        icon: "more",
      }),
    );
}

export function renderPanel(v, cx) {
  if (v.ctx() !== v.context) v.refresh(cx);
  /** @type {any} theme colors are plain strings; the element API types its color arguments as hex templates */
  const t = theme(),
    mono = settings().font_family ?? "JetBrains Mono";
  const graph = v.tab === "graph";
  v.mono = String(mono);
  hits(v);
  return v_flex()
    .id("git-panel")
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
      if (wide !== v.wide || roomy !== v.roomy) {
        v.wide = wide;
        v.roomy = roomy;
        cx.notify();
      }
    })
    .child(tabsRow(v, t))
    .child(toolbarRow(v, t))
    .when(Boolean(v.busy || v.note), (e) => e.child(noteBar(v, t)))
    .when(graph && Boolean(v.inprog), (e) => e.child(progressBanner(v, t)))
    .when(graph, (e) => e.child(commitList(v, t)))
    .when(v.tab === "prs", (e) => e.child(prPanel(v, t, mono)))
    .when(v.tab === "refs", (e) => e.child(refsPanel(v, t, mono)))
    .when(v.tab === "config", (e) => e.child(configPanel(v, t, mono)))
    .when(graph && v.more, (e) => e.child(moreBar(v, t)))
    .when(graph && Boolean(v.sel), (e) => e.child(detailPanel(v, t, mono)))
    .when(graph && v.menu, (e) => e.child(menuPanel(v, t)));
}
