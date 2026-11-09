// The Refs tab of the Git Graph mod: local branches (upstream, ahead/behind, merged), tags, stashes
// and the reflog. The lists are read-only; the only writes here are the stash actions of ADR-007
// (push, apply, pop), all run through the view's op(). A stash can be opened to see its files and
// diff in the commit detail panel of main.js. Functions take the GitGraph view as `v` and keep their state on it under
// the `refs*` names.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Scrollbar, v_virtual_list } from "gpui-base";
import { exec } from "herdr";

const ROW = 28;
// The same read-only flags as main.js: no index refresh or lock, so our own folder watch never fires.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
export const SECTIONS = [
  ["branches", "Branches"],
  ["tags", "Tags"],
  ["stashes", "Stashes"],
  ["reflog", "Reflog"],
];
const NOUN = {
  branches: ["branch", "branches"],
  tags: ["tag", "tags"],
  stashes: ["stash", "stashes"],
  reflog: ["entry", "entries"],
};
const EMPTY = {
  branches: "No branches",
  tags: "No tags",
  stashes: "No stashes",
  reflog: "No reflog entries",
};
/** Appends an alpha byte to a #rrggbb theme color; the cast satisfies the element API's hex-template type. */
const alpha = (color, a) => /** @type {`#${string}`} */ (color + a);

// for-each-ref understands `%1f` (not `%x1f`, which is for `log`-style formats) as a unit separator.
const BRANCH_FORMAT =
  "%(HEAD)%1f%(refname:short)%1f%(upstream:short)%1f%(upstream:track)%1f%(committerdate:relative)%1f%(objectname)%1f%(contents:subject)";
// %(*objectname) is the commit an annotated tag points at (empty for a lightweight tag, whose %(objectname) is the commit).
const TAG_FORMAT =
  "%(refname:short)%1f%(objecttype)%1f%(creatordate:relative)%1f%(contents:subject)%1f%(objectname)%1f%(*objectname)";

const lines = (text) => text.split("\n").filter(Boolean);

/**
 * Parses `for-each-ref refs/heads` output in BRANCH_FORMAT. `merged` holds the names that are
 * reachable from HEAD. `upstream:track` is `[ahead 2, behind 1]`, `[gone]`, or empty.
 * @param {string} text
 * @param {Set<string>} merged
 */
export function parseBranches(text, merged) {
  return lines(text).map((line) => {
    const [head, name, upstream, track, when, hash, subject] = line.split("\x1f");
    const ahead = /ahead (\d+)/.exec(track ?? ""),
      behind = /behind (\d+)/.exec(track ?? "");
    return {
      name,
      current: head === "*",
      upstream: upstream ?? "",
      gone: track === "[gone]",
      ahead: ahead ? Number(ahead[1]) : 0,
      behind: behind ? Number(behind[1]) : 0,
      when: when ?? "",
      short: (hash ?? "").slice(0, 7),
      subject: subject ?? "",
      merged: merged.has(name),
    };
  });
}

/** Parses `for-each-ref refs/tags` output in TAG_FORMAT; an annotated tag has object type `tag`. */
export function parseTags(text) {
  return lines(text).map((line) => {
    const [name, type, when, subject, hash, peeled] = line.split("\x1f");
    return {
      name,
      annotated: type === "tag",
      when: when ?? "",
      subject: subject ?? "",
      short: (peeled || hash || "").slice(0, 7),
    };
  });
}

/** Parses `stash list --format=%gd%x1f%H%x1f%cr%x1f%gs`. */
export function parseStashes(text) {
  return lines(text).map((line) => {
    const [ref, hash, when, message] = line.split("\x1f");
    return { ref, hash, short: (hash ?? "").slice(0, 7), when: when ?? "", message: message ?? "" };
  });
}

/** Parses `reflog --format=%H%x1f%gd%x1f%gs%x1f%cr`. */
export function parseReflog(text) {
  return lines(text).map((line) => {
    const [hash, ref, message, when] = line.split("\x1f");
    return { ref, short: (hash ?? "").slice(0, 7), message: message ?? "", when: when ?? "" };
  });
}

export function resetRefs(v) {
  v.refs = { branches: [], tags: [], stashes: [], reflog: [] };
  v.refsError = null;
  v.refsSig = null;
}

export function initRefs(v) {
  v.refsSection = "branches";
  v.refsLoading = false;
  v.stashMsg = InputState.new({ placeholder: "Stash message (optional)" });
  resetRefs(v);
}

export function setRefsSection(v, section, cx) {
  if (v.refsSection === section) return;
  v.refsSection = section;
  // A stash is the only thing that can be open, and only under Stashes.
  if (v.sel) v.clearSel();
  cx.notify();
}

// Re-reads the lists; the view is only repainted when the output changed.
export function loadRefs(v, cx, force = false) {
  // refsLoading holds the context being read, so a repo switch is not held up by a stale read.
  if (v.refsLoading === (v.context ?? null) || !v.root) return;
  const context = v.context,
    root = v.root,
    on = v.on;
  v.refsLoading = context;
  cx.spawn(async (cx) => {
    let changed = false;
    try {
      const git = (args) => exec("git", [...READ, ...args], { cwd: root, on, timeout: 30000 });
      const [branches, merged, tags, stashes, reflog] = await Promise.all([
        git(["for-each-ref", "--sort=-committerdate", `--format=${BRANCH_FORMAT}`, "refs/heads"]),
        git(["for-each-ref", "--merged", "HEAD", "--format=%(refname:short)", "refs/heads"]),
        git(["for-each-ref", "--sort=-creatordate", `--format=${TAG_FORMAT}`, "refs/tags"]),
        git(["stash", "list", "-n", "100", "--format=%gd%x1f%H%x1f%cr%x1f%gs"]),
        git(["reflog", "-n", "100", "--format=%H%x1f%gd%x1f%gs%x1f%cr"]),
      ]);
      if (v.context !== context) return;
      // Without any commit `merged` and `reflog` fail; that is an empty list, not an error. Only the
      // branch and tag reads must succeed.
      for (const r of [branches, tags])
        if (r.code !== 0)
          throw new Error(r.stderr.trim().split("\n").slice(-3).join("\n") || `git exited with ${r.code}`);
      const sig = [branches, merged, tags, stashes, reflog].map((r) => (r.code === 0 ? r.stdout : "")).join("\0");
      if (force || sig !== v.refsSig || v.refsError) {
        v.refs = {
          branches: parseBranches(branches.stdout, new Set(lines(merged.code === 0 ? merged.stdout : ""))),
          tags: parseTags(tags.stdout),
          stashes: stashes.code === 0 ? parseStashes(stashes.stdout) : [],
          reflog: reflog.code === 0 ? parseReflog(reflog.stdout) : [],
        };
        v.refsSig = sig;
        v.refsError = null;
        changed = true;
        // An open stash that no longer exists would show a stale diff.
        if (v.sel && v.tab === "refs" && !v.refs.stashes.some((s) => s.hash === v.sel)) v.clearSel();
      }
    } catch (e) {
      if (v.context === context) {
        resetRefs(v);
        if (v.sel && v.tab === "refs") v.clearSel();
        v.refsError = String(e?.message ?? e);
        changed = true;
      }
    } finally {
      if (v.refsLoading === context) v.refsLoading = false;
      if (changed) cx.notify();
    }
  });
}

const HASH = /^[0-9a-f]{40,64}$/,
  STASH_REF = /^stash@\{\d+\}$/;

// `git stash push --include-untracked [-m <msg>]`: moves the changes (untracked files too) into a
// new stash entry. Nothing is lost: Apply or Pop brings them back.
function stashChanges(v, cx) {
  const block = v.writeBlock();
  if (block) return v.refuse(block, cx);
  if (v.work?.changed === 0) return v.refuse("Nothing to stash: the working tree is clean", cx);
  const msg = v.stashMsg.value().trim();
  v.op("Stash changes", ["stash", "push", "--include-untracked", ...(msg ? ["-m", msg] : [])], cx, "git", {
    done: () => v.stashMsg.set_value(""),
  });
}

// `git stash apply <hash>`: the stash is named by its commit, so a list that shifted since it was
// read cannot make this apply another one. The stash entry stays; git refuses to overwrite local changes.
function applyStash(v, s, cx) {
  const block = v.writeBlock();
  if (block) return v.refuse(block, cx);
  if (!HASH.test(s.hash)) return;
  v.op(`Apply ${s.ref}`, ["stash", "apply", s.hash], cx);
}

// `git stash pop stash@{n}` needs a second click, and only runs while that entry is still the stash
// that was clicked (its index can shift when another stash is pushed or dropped).
function popStash(v, s, cx) {
  const block = v.writeBlock();
  if (block) return v.refuse(block, cx);
  if (!HASH.test(s.hash) || !STASH_REF.test(s.ref)) return;
  if (!v.confirm(`pop:${s.hash}`, cx)) return;
  v.op(`Pop ${s.ref}`, ["stash", "pop", s.ref], cx, "git", {
    check: async (run) => {
      const r = await run(["rev-parse", "--verify", "--quiet", s.ref]);
      return r.code === 0 && r.stdout.trim() === s.hash
        ? null
        : `${s.ref} is no longer the stash you picked: reload and pick it again`;
    },
    ok: `Popped ${s.ref}. To bring the entry back: git stash store ${s.hash}`,
  });
}

// Header controls while this tab shows: the four lists with their counts, the stash controls under
// Stashes, and a reload.
export function refsToolbar(v, t) {
  return [
    ...SECTIONS.map(([id, label]) =>
      v.button(
        `gg-refs-${id}`,
        v.refs[id].length ? `${label} ${v.refs[id].length}` : label,
        (cx) => setRefsSection(v, id, cx),
        t,
        { tone: v.refsSection === id ? t.accent : null },
      ),
    ),
    div().flex_1(),
    ...(v.refsSection === "stashes"
      ? [
          v.field("gg-stash-msg", v.stashMsg, t).w(220),
          v.button("gg-stash-push", "Stash changes", (cx) => stashChanges(v, cx), t, {
            disabled: !v.root || Boolean(v.busy) || v.work?.changed === 0,
          }),
        ]
      : []),
    v.button(
      "gg-refs-reload",
      "Reload",
      (cx) => {
        v.refsSig = null;
        loadRefs(v, cx, true);
      },
      t,
      { disabled: Boolean(v.refsLoading) || !v.root, icon: "fetch" },
    ),
  ];
}

const cell = (width, t, text, color, mono) =>
  div()
    .w(width)
    .flex_none()
    .truncate()
    .text_size(12)
    .when(Boolean(mono), (e) => e.font_family(mono))
    .text_color(color ?? t.dim)
    .child(text);

const rowBase = () => h_flex().w_full().h(ROW).flex_none().px(14).gap(10).items_center();

function branchRow(v, b, t, mono) {
  return rowBase()
    .when(b.current, (e) => e.bg(alpha(t.accent, "18")))
    .hover((s) => s.bg(t.hover))
    .child(
      div()
        .w(14)
        .flex_none()
        .text_color(t.accent)
        .child(b.current ? "●" : ""),
    )
    .child(
      div()
        .w(v.wide ? 220 : 150)
        .flex_none()
        .truncate()
        .font_family(mono)
        .text_size(13)
        .text_color(t.foreground)
        .when(b.current, (e) => e.font_semibold())
        .child(b.name),
    )
    .child(
      h_flex()
        .w(v.wide ? 250 : 140)
        .flex_none()
        .gap(6)
        .items_center()
        .child(
          div()
            .min_w(0)
            .truncate()
            .text_size(12)
            .text_color(b.upstream ? t.muted : t.dim)
            .child(b.upstream || "no upstream"),
        )
        .when(b.gone, (e) => e.child(v.pill("gone", t.ansi1).h(18).px(5).text_size(11)))
        .when(b.ahead > 0, (e) => e.child(v.pill(`↑${b.ahead}`, t.ansi2).h(18).px(5).text_size(11)))
        .when(b.behind > 0, (e) => e.child(v.pill(`↓${b.behind}`, t.ansi3).h(18).px(5).text_size(11))),
    )
    .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(b.subject))
    .when(b.merged && !b.current, (e) => e.child(v.pill("merged", t.ansi5).h(18).px(5).text_size(11)))
    .when(v.wide, (e) => e.child(cell(60, t, b.short, null, mono)).child(cell(105, t, b.when)));
}

function tagRow(v, g, t, mono) {
  return rowBase()
    .hover((s) => s.bg(t.hover))
    .child(
      div()
        .w(v.wide ? 220 : 150)
        .flex_none()
        .truncate()
        .font_family(mono)
        .text_size(13)
        .text_color(t.ansi3)
        .child(g.name),
    )
    .child(
      div()
        .w(78)
        .flex_none()
        .child(g.annotated ? v.pill("annotated", t.ansi5).h(18).px(5).text_size(11) : div()),
    )
    .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(g.subject))
    .when(v.wide, (e) => e.child(cell(60, t, g.short, null, mono)).child(cell(105, t, g.when)));
}

function stashRow(v, s, t, mono) {
  const picked = v.sel === s.hash;
  return rowBase()
    .cursor_pointer()
    .border_l(2)
    .border_color(picked ? t.accent : alpha(t.accent, "00"))
    .when(picked, (e) => e.bg(t.selected))
    .hover((s2) => s2.bg(t.hover))
    .child(cell(90, t, s.ref, t.accent, mono))
    .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(s.message))
    .when(v.wide, (e) => e.child(cell(60, t, s.short, null, mono)))
    .child(cell(105, t, s.when));
}

function reflogRow(v, r, t, mono) {
  return rowBase()
    .hover((s) => s.bg(t.hover))
    .child(cell(90, t, r.ref, t.dim, mono))
    .child(cell(60, t, r.short, t.dim, mono))
    .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(r.message))
    .child(cell(105, t, r.when));
}

const RENDER = { branches: branchRow, tags: tagRow, stashes: stashRow, reflog: reflogRow };

// Actions on the open stash, between the list and its diff.
function stashBar(v, t, mono, s) {
  const pop = v.armed === `pop:${s.hash}`;
  const guarded = (fn) => (cx) => {
    if (!v.blocked()) fn(cx);
  };
  return h_flex()
    .h(44)
    .flex_none()
    .px(14)
    .gap(8)
    .items_center()
    .border_t(1)
    .border_color(t.border)
    .child(div().flex_none().font_family(mono).text_size(12).text_color(t.accent).child(s.ref))
    .child(
      div()
        .flex_1()
        .min_w(0)
        .truncate()
        .text_size(12)
        .text_color(t.dim)
        .child("Apply keeps the stash; Pop removes it once applied"),
    )
    .child(
      v.small(
        "gg-stash-apply",
        "Apply",
        guarded((cx) => applyStash(v, s, cx)),
        t,
      ),
    )
    .child(
      v.small(
        "gg-stash-pop",
        pop ? "Click again to pop" : "Pop",
        guarded((cx) => popStash(v, s, cx)),
        t,
        pop ? t.ansi1 : null,
      ),
    );
}

export function refsPanel(v, t, mono) {
  const section = v.refsSection,
    items = v.refs[section];
  const empty =
    v.refsError ?? (!v.root ? "Not a git repository" : v.refsLoading && !items.length ? "Loading…" : EMPTY[section]);
  const open = section === "stashes" && v.sel ? items.find((s) => s.hash === v.sel) : null;
  // Two stash entries can hold the same commit (`git stash store`), so a stash is keyed by its entry, `stash@{n}`.
  const key = section === "stashes" ? (i) => items[i].ref : (i) => String(i);
  const list = v_virtual_list(`gg-refs-list-${section}`, items.length, ROW, key, (range) =>
    items.slice(range.start, range.end).map((x) => RENDER[section](v, x, t, mono)),
  ).size_full();
  return v_flex()
    .flex_1()
    .min_h(0)
    .child(
      div()
        .flex_1()
        .min_h(0)
        .relative()
        // No handlers inside the renderer: a stash opens through the list's on_item_click.
        .child(
          section === "stashes"
            ? list.on_item_click((ref, cx) => {
                const hash = items.find((s) => s.ref === ref)?.hash;
                if (hash && !v.blocked()) v.select(hash, cx);
              })
            : list,
        )
        .child(Scrollbar.vertical(`gg-refs-list-${section}`).viewport_from_layout().absolute().inset_0())
        .when(!items.length, (e) => e.child(v.emptyState(empty, v.refsError ? t.ansi1 : t.dim, t))),
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
        .child(
          `${items.length} ${NOUN[section][items.length === 1 ? 0 : 1]}${
            section === "stashes"
              ? " · click one to see its changes"
              : section === "reflog"
                ? " · most recent 100"
                : " · read-only"
          }`,
        ),
    )
    .when(Boolean(open), (e) => e.child(stashBar(v, t, mono, open)))
    .when(Boolean(open), (e) =>
      e.child(v.detailPanel(t, mono, { hash: open.hash, short: open.short, parents: [], refs: [] })),
    );
}
