// Shared widgets of the Git Panel mod: buttons, inputs, pills and the empty-state text.
// Plain functions that build elements; the view class forwards to them (see main.js).
import { div, svg } from "gpui-kit";
import { Input } from "gpui-base";
import { alpha } from "./shared.js";

// icon: a name for mods/git-panel/<icon>.svg, drawn in the button's text colour.
export function button(v, id, label, fn, t, { disabled = false, tone = null, icon = null } = {}) {
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
          if (!v.blocked()) fn(cx);
        }),
    )
    .children([
      ...(icon ? [svg(`mods/git-panel/${icon}.svg`).size(14).flex_none().text_color(color)] : []),
      ...(Array.isArray(label) ? label : [label]),
    ]);
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

// A small bordered button for the detail panels (no icon; callers gate on blocked() when the branch menu could be over it).
export function small(v, id, label, fn, t, tone = null) {
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

export function tabButton(v, id, label, name, t) {
  const on = v.tab === name;
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
      if (!v.blocked()) v.setTab(name, cx);
    })
    .child(label);
}
