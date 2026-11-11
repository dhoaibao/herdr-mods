// Shared widgets of the Git Panel mod: buttons, inputs, pills and the empty-state text.
// Plain functions that build elements; the view class forwards to them (see main.js).
import { div, svg } from "gpui-kit";
import { Input } from "gpui-base";
import { alpha } from "./shared.js";

// What each icon (a name for mods/git-panel/<icon>.svg) is tinted when its button is not toned:
// incoming yellow, outgoing green, merged purple, destructive red, the rest blue or quiet.
const TINT = {
  branch: (t) => t.accent,
  "branch-plus": (t) => t.ansi2,
  fetch: (t) => t.ansi4,
  reload: (t) => t.ansi6,
  pull: (t) => t.ansi3,
  push: (t) => t.ansi2,
  tag: (t) => t.ansi3,
  checkout: (t) => t.ansi4,
  external: (t) => t.ansi4,
  rename: (t) => t.ansi4,
  history: (t) => t.ansi5,
  diff: (t) => t.ansi5,
  merge: (t) => t.ansi5,
  cherry: (t) => t.ansi5,
  undo: (t) => t.ansi3,
  archive: (t) => t.ansi3,
  restore: (t) => t.ansi3,
  ready: (t) => t.ansi2,
  check: (t) => t.ansi2,
  pr: (t) => t.ansi2,
  "pr-closed": (t) => t.ansi1,
  trash: (t) => t.ansi1,
  ban: (t) => t.ansi1,
};

// One bordered button. A `tone` (the armed second click, the chosen filter, a suggested pull or
// push) tints the fill, border, text and icon in that color; otherwise the label is neutral and the
// icon takes its TINT. `label` may be empty for an icon-only button, which then needs a `tip`.
function chip(v, id, label, fn, t, { h, px, size, guard, disabled = false, tone = null, icon = null, tip = null }) {
  const lit = !disabled && tone;
  const ink = disabled ? t.dim : (tone ?? t.foreground);
  const mark = disabled ? t.dim : (tone ?? TINT[icon]?.(t) ?? t.muted);
  const bare = label === null || label === "";
  return div()
    .id(id)
    .h(h)
    .flex_none()
    .flex()
    .items_center()
    .when(bare, (e) => e.w(h).justify_center())
    .when(!bare, (e) => e.px(px))
    .gap(6)
    .rounded(6)
    .border_1()
    .border_color(lit ? alpha(tone, "66") : t.border)
    .when(Boolean(lit), (e) => e.bg(alpha(tone, "18")))
    .text_size(13)
    .text_color(ink)
    .when(Boolean(tip), (e) => e.tooltip(tip))
    .when(!disabled, (e) =>
      e
        .cursor_pointer()
        .hover((s) => (lit ? s.bg(alpha(tone, "30")) : s.bg(t.hover).border_color(t.dim)))
        .active((s) => s.bg(t.selected))
        .on_click((_e, cx) => {
          if (!guard || !v.blocked()) fn(cx);
        }),
    )
    .children([
      ...(icon ? [svg(`mods/git-panel/${icon}.svg`).size(size).flex_none().text_color(mark)] : []),
      ...(bare ? [] : Array.isArray(label) ? label : [label]),
    ]);
}

// A toolbar button: 28 px, ignores a click that only dismissed the branch menu.
export function button(v, id, label, fn, t, { disabled = false, tone = null, icon = null, tip = null } = {}) {
  return chip(v, id, label, fn, t, { h: 28, px: 12, size: 14, guard: true, disabled, tone, icon, tip });
}

// Loading, empty and error text for a list area: centred over it instead of tucked in the corner.
export function emptyState(v, text, color, t) {
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

// A bordered one-line input (the caller sets its width). The mouse-down guard keeps the click from
// reaching what lies behind it.
export function field(v, id, state, t) {
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

// A small button for the detail panels (callers gate on blocked() when the branch menu could be over it).
export function small(v, id, label, fn, t, tone = null, { icon = null, disabled = false, tip = null } = {}) {
  return chip(v, id, label, fn, t, { h: 26, px: 10, size: 13, guard: false, disabled, tone, icon, tip });
}

// A small tinted pill: the ahead/behind counts beside the branch chip, and `remote` in the branch menu.
export function pill(v, text, color) {
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

export function tabButton(v, id, label, name, t, icon) {
  const on = v.tab === name;
  return div()
    .id(id)
    .px(12)
    .h_full()
    .flex()
    .items_center()
    .gap(7)
    .text_size(14)
    .text_color(on ? t.foreground : t.muted)
    .border_b(2)
    .border_color(on ? t.accent : t.background)
    .cursor_pointer()
    .hover((s) => s.text_color(t.foreground))
    .on_click((_e, cx) => {
      if (!v.blocked()) v.setTab(name, cx);
    })
    .child(
      svg(`mods/git-panel/${icon}.svg`)
        .size(15)
        .flex_none()
        .text_color(on ? t.accent : t.dim),
    )
    .child(label);
}
