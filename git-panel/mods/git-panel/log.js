// Reading the commit list: `git log` parsing, search matching and the lane layout of the graph.
// Pure functions, no view state.
import { MAX_LANES } from "./shared.js";

export const FORMAT = "%H%x1f%P%x1f%an%x1f%ar%x1f%D%x1f%s%x1e";

export function parseLog(text) {
  return text
    .split("\x1e")
    .map((r) => r.replace(/^\n/, ""))
    .filter(Boolean)
    .map((r) => {
      const [hash, parents, author, when, refs, subject] = r.split("\x1f");
      return {
        hash,
        short: hash.slice(0, 7),
        parents: parents ? parents.split(" ") : [],
        author,
        when,
        subject,
        refs: refs
          ? refs.split(", ").map((x) => {
              if (x.startsWith("HEAD -> ")) return { name: x.slice(8), kind: "head" };
              if (x === "HEAD") return { name: "HEAD", kind: "head" };
              if (x.startsWith("tag: ")) return { name: x.slice(5), kind: "tag" };
              return { name: x, kind: x.includes("/") ? "remote" : "local" };
            })
          : [],
      };
    });
}

// Whether a commit matches the (lowercased) search text: subject, author, a ref name, or the start of its hash.
export function matches(c, q) {
  return (
    c.subject.toLowerCase().includes(q) ||
    c.author.toLowerCase().includes(q) ||
    c.hash.startsWith(q) ||
    c.refs.some((r) => r.name.toLowerCase().includes(q))
  );
}

// Assigns each commit a lane and records, per row, which lanes enter from above (before),
// leave below (after), and which other lanes join or branch off at this commit.
export function layout(commits) {
  let lanes = [],
    max = 1;
  const rows = [];
  for (const c of commits) {
    const before = lanes.slice();
    let i = before.indexOf(c.hash);
    if (i < 0) {
      i = before.indexOf(null);
      if (i < 0) i = before.length;
    }
    const after = before.slice();
    while (after.length <= i) after.push(null);
    const joins = [],
      links = [];
    for (let j = 0; j < before.length; j++) {
      if (j !== i && before[j] === c.hash) {
        after[j] = null;
        joins.push(j);
      }
    }
    after[i] = c.parents[0] ?? null;
    for (const p of c.parents.slice(1)) {
      let k = after.indexOf(p);
      if (k < 0) {
        k = after.indexOf(null);
        if (k < 0) k = after.length;
        after[k] = p;
      }
      links.push(k);
    }
    while (after.length && after[after.length - 1] === null) after.pop();
    max = Math.max(max, before.length, after.length, i + 1);
    rows.push({ c, lane: i, before, after, joins, links, topIn: before[i] === c.hash });
    lanes = after;
  }
  return { rows, lanes: Math.min(max, MAX_LANES) };
}
