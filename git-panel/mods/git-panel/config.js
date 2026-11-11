// The Config tab of the Git Panel mod: a read-only view of the effective git configuration for the
// repository (`git config --list --show-origin --show-scope`), grouped by section, with the scope
// each setting comes from. Nothing here writes configuration. Functions take the GitPanel view as `v`
// and keep their state on it under the `cfg*` names.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list } from "gpui-base";
import { exec, props } from "herdr";

const ROW = 28;
export const CONFIG_SCOPES = [
  ["all", "All"],
  ["local", "Local"],
  ["global", "Global"],
];
// Best effort: git has no marker for secrets, so this masks the credential-bearing shapes git documents
// (URL userinfo, proxy userinfo, password/token/secret-like variables, extraHeader) and nothing else.
const SECRET_NAME = /(pass|token|secret|extraheader)/i;
const MASK = "••••••";

const isWord = (c) => /[\w-]/.test(c);
const isSchemeChar = (c) => /[a-z0-9+.-]/i.test(c);

/**
 * `https://user:token@host/…` -> `https://••••••@host/…`; a plain `git@host` login stays.
 * Written as scanners over `indexOf`, not regexes: every character is visited a bounded number of times,
 * so a hostile value cannot make the mask slow (the config text is not trusted).
 */
function maskUrls(text) {
  let out = "",
    from = 0,
    i = text.indexOf("://");
  while (i >= 0) {
    // The authority runs to the next `/` or whitespace; userinfo is everything before its last `@`
    // (a raw `@` inside a password stays hidden too).
    let end = i + 3;
    while (end < text.length && text[end] !== "/" && !/\s/.test(text[end])) end++;
    // The scheme is the run of scheme characters before `://`, starting at its first letter.
    let start = i;
    while (start > from && isSchemeChar(text[start - 1])) start--;
    while (start < i && !/[a-z]/i.test(text[start])) start++;
    let at = end - 1;
    while (at > i + 2 && text[at] !== "@") at--; // bounded by the authority, unlike lastIndexOf over the whole text
    if (start < i && at > i + 2) {
      const info = text.slice(i + 3, at);
      if (info.includes(":") || info.length >= 20) {
        out += text.slice(from, i + 3) + MASK;
        from = at;
      }
    }
    i = text.indexOf("://", i + 3);
  }
  return out + text.slice(from);
}

/** `name=value` pairs whose name contains pass/token/secret keep the name and quote; the value is hidden. */
function maskAssignments(text) {
  let out = "",
    from = 0,
    i = text.indexOf("=");
  while (i >= 0) {
    let start = i;
    while (start > from && isWord(text[start - 1])) start--;
    if (start < i && /pass(?:wo?r?d)?|token|secret/i.test(text.slice(start, i))) {
      let v = i + 1;
      if (text[v] === '"' || text[v] === "'") v++;
      let end = v;
      while (end < text.length && !/[\s;&'"]/.test(text[end])) end++;
      if (end > v) {
        out += text.slice(from, v) + MASK;
        from = end;
        i = text.indexOf("=", end);
        continue;
      }
    }
    // A pair that is not a secret never consumes its value: a secret assignment may follow inside it.
    i = text.indexOf("=", i + 1);
  }
  return out + text.slice(from);
}

/** The setting name without its subsection: `remote.origin.proxy` -> `proxy`. */
const variable = (key) => key.slice(key.lastIndexOf(".") + 1);

/** A key can carry a URL too (`url.<base>.insteadOf`), so it is masked like a value. */
export function maskKey(key) {
  return maskUrls(key);
}

// `proxy` accepts `[scheme://]user:password@host`, so it can hold a password without a scheme.
function maskProxy(value) {
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(value)?.[0] ?? "";
  let end = scheme.length;
  while (end < value.length && value[end] !== "/" && !/\s/.test(value[end])) end++;
  const at = value.lastIndexOf("@", end - 1);
  return at > scheme.length && value.slice(scheme.length, at).includes(":") ? scheme + MASK + value.slice(at) : value;
}

export function maskValue(key, value) {
  const name = variable(key);
  if (SECRET_NAME.test(name)) return MASK;
  if (name.toLowerCase() === "proxy") value = maskProxy(value);
  // Inline scripts (a `!` credential helper, an alias) can carry `password=…`, `GH_TOKEN=…` or `client_secret='…'`.
  return maskAssignments(maskUrls(value));
}

/**
 * Parses `git config --list --show-origin --show-scope -z`: records of
 * `scope NUL origin NUL key [LF value] NUL` (a key without a value has no LF).
 */
export function parseConfig(text) {
  const parts = text.split("\0");
  const out = [];
  for (let i = 0; i + 2 < parts.length; i += 3) {
    const [scope, origin, kv] = [parts[i], parts[i + 1], parts[i + 2]];
    const nl = kv.indexOf("\n");
    const rawKey = nl < 0 ? kv : kv.slice(0, nl);
    const raw = nl < 0 ? "" : kv.slice(nl + 1);
    if (!rawKey) continue;
    const key = maskKey(rawKey);
    out.push({
      scope,
      origin: origin.replace(/^file:/, ""),
      key,
      value: maskValue(rawKey, raw),
      section: key.slice(0, key.indexOf(".") < 0 ? key.length : key.indexOf(".")),
    });
  }
  return out;
}

export function resetConfig(v) {
  v.cfg = [];
  v.cfgError = null;
  v.cfgSig = null;
}

export function initConfig(v) {
  v.cfgScope = CONFIG_SCOPES.some(([id]) => id === props()?.scope) ? props().scope : "all";
  v.cfgFind = "";
  v.cfgLoading = false;
  resetConfig(v);
  v.cfgInput = InputState.new({ placeholder: "Filter settings" });
  v.cfgInput.on("change", (_e, cx) => {
    v.cfgFind = v.cfgInput.value().trim().toLowerCase();
    cx.notify();
  });
}

export function setConfigScope(v, scope, cx) {
  if (v.cfgScope === scope) return;
  v.cfgScope = scope;
  cx.notify();
}

// Re-reads the configuration; the view is only repainted when the output changed.
export function loadConfig(v, cx) {
  // cfgLoading holds the context being read, so a repo switch is not held up by a stale read.
  if (v.cfgLoading === (v.context ?? null) || !v.root) return;
  const context = v.context,
    root = v.root,
    on = v.on;
  v.cfgLoading = context;
  cx.spawn(async (cx) => {
    let changed = false;
    try {
      const r = await exec("git", ["config", "--list", "--show-origin", "--show-scope", "-z"], {
        cwd: root,
        on,
        timeout: 30000,
      });
      if (v.context !== context) return;
      if (r.code !== 0)
        throw new Error(r.stderr.trim().split("\n").slice(-3).join("\n") || `git exited with ${r.code}`);
      if (r.stdout !== v.cfgSig || v.cfgError) {
        v.cfg = parseConfig(r.stdout);
        v.cfgSig = r.stdout;
        v.cfgError = null;
        changed = true;
      }
    } catch (e) {
      if (v.context === context) {
        v.cfg = [];
        v.cfgSig = null;
        v.cfgError = String(e?.message ?? e);
        changed = true;
      }
    } finally {
      if (v.cfgLoading === context) v.cfgLoading = false;
      if (changed) cx.notify();
    }
  });
}

// Header controls while this tab shows: which scope to list, a filter box and a reload.
export function configToolbar(v, t) {
  return [
    ...CONFIG_SCOPES.map(([scope, label]) =>
      v.button(`gg-cfg-${scope}`, label, (cx) => setConfigScope(v, scope, cx), t, {
        tone: v.cfgScope === scope ? t.accent : null,
      }),
    ),
    div()
      .id("gg-cfg-find")
      .w(260)
      .h(28)
      .flex_none()
      .px(10)
      .flex()
      .items_center()
      .rounded(6)
      .border_1()
      .border_color(t.border)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(Input.new(v.cfgInput).h_full().text_size(13).text_color(t.foreground)),
    div().flex_1(),
    v.button(
      "gg-cfg-reload",
      "Reload",
      (cx) => {
        v.cfgSig = null;
        loadConfig(v, cx);
      },
      t,
      { disabled: v.cfgLoading || !v.root, icon: "reload" },
    ),
  ];
}

const SCOPE_TONE = (t, s) =>
  s === "local" ? t.ansi2 : s === "global" ? t.ansi4 : s === "system" ? t.ansi5 : s === "worktree" ? t.ansi6 : t.ansi3;

// Settings of the chosen scope that match the filter, with a heading row before each section.
function displayRows(v) {
  const rows = [];
  let section = null;
  const entries = v.cfg
    .filter((e) => v.cfgScope === "all" || e.scope === v.cfgScope)
    .filter(
      (e) =>
        !v.cfgFind ||
        e.key.toLowerCase().includes(v.cfgFind) ||
        e.value.toLowerCase().includes(v.cfgFind) ||
        e.origin.toLowerCase().includes(v.cfgFind),
    )
    // Stable sort: sections alphabetical, keys keep git's order within a section.
    .map((e, i) => [e, i])
    .sort((a, b) => (a[0].section < b[0].section ? -1 : a[0].section > b[0].section ? 1 : a[1] - b[1]))
    .map(([e]) => e);
  for (const e of entries) {
    if (e.section !== section) {
      section = e.section;
      rows.push({ head: section });
    }
    rows.push(e);
  }
  return { rows, count: entries.length };
}

function configRow(v, r, t, mono) {
  if (r.head !== undefined)
    return h_flex()
      .w_full()
      .h(ROW)
      .flex_none()
      .px(14)
      .items_end()
      .pb(4)
      .text_size(12)
      .text_color(t.dim)
      .font_semibold()
      .child(r.head.toUpperCase());
  return h_flex()
    .w_full()
    .h(ROW)
    .flex_none()
    .px(14)
    .gap(8)
    .items_center()
    .hover((s) => s.bg(t.hover))
    .child(div().w(62).flex_none().truncate().text_size(12).text_color(SCOPE_TONE(t, r.scope)).child(r.scope))
    .child(
      div()
        .w(v.wide ? 280 : 180)
        .flex_none()
        .truncate()
        .font_family(mono)
        .text_size(13)
        .text_color(t.accent)
        .child(r.key),
    )
    .child(
      div()
        .flex_1()
        .min_w(0)
        .truncate()
        .font_family(mono)
        .text_size(13)
        .text_color(r.value ? t.foreground : t.dim)
        .child(r.value || "(no value)"),
    )
    .when(v.wide, (e) => e.child(div().w(240).flex_none().truncate().text_size(12).text_color(t.dim).child(r.origin)));
}

export function configPanel(v, t, mono) {
  const { rows, count } = displayRows(v);
  const empty =
    v.cfgError ??
    (!v.root
      ? "Not a git repository"
      : v.cfgLoading && !v.cfg.length
        ? "Loading config…"
        : v.cfg.length
          ? "No matching settings"
          : "No settings");
  return v_flex()
    .flex_1()
    .min_h(0)
    .child(
      div()
        .flex_1()
        .min_h(0)
        .relative()
        .child(
          v_virtual_list(
            "gg-cfg",
            rows.length,
            ROW,
            (i) => String(i),
            (range) => rows.slice(range.start, range.end).map((r) => configRow(v, r, t, mono)),
          ).size_full(),
        )
        .child(Scrollbar.vertical("gg-cfg").viewport_from_layout().absolute().inset_0())
        .when(!rows.length, (e) => e.child(v.emptyState(empty, v.cfgError ? t.ansi1 : t.dim, t))),
    )
    .child(
      h_flex()
        .h(34)
        .flex_none()
        .px(14)
        .items_center()
        .border_t(1)
        .border_color(t.border)
        .text_size(12)
        .text_color(t.dim)
        .child(`${count} setting${count === 1 ? "" : "s"} · read-only; later scopes override earlier ones`),
    );
}
