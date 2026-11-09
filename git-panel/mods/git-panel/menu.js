// The branch menu of the Graph tab: the branch list, the filter and creating or switching a branch.
import { div } from "gpui-kit";
import { v_flex, h_flex, Input, Scrollbar, v_virtual_list } from "gpui-base";
import { exec } from "herdr";
import { validRefName } from "./refs.js";
import { READ, ROW, alpha } from "./shared.js";
import { op } from "./ops.js";
import { pill } from "./ui.js";

export function closeMenu(v, cx) {
  v.menu = false;
  v.guard = Date.now() + 400;
  cx.notify();
}

export function openMenu(v, cx) {
  if (v.menu) {
    closeMenu(v, cx);
    return;
  }
  v.menu = true;
  v.filter = "";
  v.input.set_value("");
  loadBranches(v, cx);
  cx.timer.after(60, (cx) => v.input.focus());
  cx.notify();
}

export function loadBranches(v, cx) {
  const context = v.context,
    root = v.root,
    on = v.on;
  cx.spawn(async (cx) => {
    try {
      const r = await exec(
        "git",
        [...READ, "for-each-ref", "--sort=-committerdate", "--format=%(refname)", "refs/heads", "refs/remotes"],
        { cwd: root, on },
      );
      if (v.context !== context) return;
      const local = [],
        remote = [];
      for (const ref of r.stdout.split("\n").filter(Boolean)) {
        // A name starting with "-" would be parsed by `git switch` as an option.
        if (ref.startsWith("refs/heads/") && ref[11] !== "-") local.push(ref.slice(11));
        else if (ref.startsWith("refs/remotes/") && ref[13] !== "-" && !ref.endsWith("/HEAD"))
          remote.push(ref.slice(13));
      }
      const have = new Set(local);
      v.branches = [
        ...local.map((n) => ({ key: `l:${n}`, name: n, kind: "local" })),
        ...remote
          .filter((n) => !have.has(n.slice(n.indexOf("/") + 1)))
          .map((n) => ({ key: `r:${n}`, name: n, kind: "remote" })),
      ];
    } catch {
      v.branches = [];
    }
    cx.notify();
  });
}

export function menuItems(v) {
  const f = v.filter.toLowerCase();
  const items = v.branches.filter((b) => !f || b.name.toLowerCase().includes(f));
  const valid = validRefName(v.filter);
  const exists = v.branches.some((b) => b.kind === "local" && b.name === v.filter);
  return v.filter && valid && !exists ? [{ key: `n:${v.filter}`, name: v.filter, kind: "new" }, ...items] : items;
}

export function checkout(v, key, cx) {
  const kind = key[0],
    name = key.slice(2);
  closeMenu(v, cx);
  if (name.startsWith("-")) return;
  if (kind === "n") op(v, `Create ${name}`, ["switch", "-c", name], cx);
  else op(v, `Switch to ${name}`, kind === "r" ? ["switch", "--track", name] : ["switch", name], cx);
}

export function branchRow(v, b, t) {
  const current = b.kind === "local" && b.name === v.branch;
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
    .when(b.kind === "remote", (e) => e.child(pill(v, "remote", t.ansi4).h(18).px(5).text_size(11)));
}

export function menuPanel(v, t) {
  const items = menuItems(v);
  return div()
    .absolute()
    .inset_0()
    .child(
      div()
        .id("gg-backdrop")
        .absolute()
        .inset_0()
        .on_click((_e, cx) => closeMenu(v, cx)),
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
            .child(Input.new(v.input).h_full().text_size(13).text_color(t.foreground)),
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
                (range) => items.slice(range.start, range.end).map((b) => branchRow(v, b, t)),
              )
                .size_full()
                .on_item_click((key, cx) => checkout(v, key, cx)),
            )
            .child(Scrollbar.vertical("gg-branches").viewport_from_layout().absolute().inset_0())
            .when(!items.length, (e) =>
              e.child(div().absolute().top(8).px(12).text_color(t.dim).child("No matching branch")),
            ),
        ),
    );
}
