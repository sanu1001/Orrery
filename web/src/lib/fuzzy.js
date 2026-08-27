// @ts-check

/**
 * Subsequence matching for the command palette.
 *
 * Not Levenshtein and not a substring test. A palette is used by typing the
 * initials of a thing you already know the name of -- "bfm" for "Breadth-First
 * Search (maze)", "lca" for "Lowest Common Ancestor" -- and neither of those
 * finds it. Subsequence with a score does, and it is forty lines rather than a
 * dependency.
 *
 * The scoring rules exist because raw subsequence matching ranks terribly: "bf"
 * matches "Bellman-Ford" and "Breadth-First Search" and also "BST Delete"
 * (B...st...delete has no f, so not that one -- but "sd" matches half the
 * catalogue). Word starts and contiguous runs are what separate the thing you
 * meant from the things that merely contain the letters.
 */

/** Characters after which the next letter starts a word. */
const BOUNDARY = /[\s\-_/.,()[\]]/;

/**
 * @param {string} query
 * @param {string} text
 * @returns {number} higher is better; -1 means no match
 */
export function score(query, text) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  let total = 0;
  let run = 0;
  let last = -2;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    // A run is what makes "merge" beat "m...e...r...g...e" scattered across a
    // sentence, and it is the single most important term here.
    run = last === ti - 1 ? run + 1 : 1;
    const atWordStart = ti === 0 || BOUNDARY.test(t[ti - 1]);
    total += 1 + run * 3 + (atWordStart ? 6 : 0);
    // A tiny bonus for matching near the front, so "list" prefers "List Merge"
    // over "Partition a Linked List". Small, because it must not outweigh a
    // word-start match further along.
    if (ti < 10) total += 1;
    last = ti;
    qi++;
  }
  if (qi < q.length) return -1;
  // Shorter names win ties: "DFS" and "Depth-First Search over a Forest" score
  // the same on "dfs", and the first is what was meant.
  return total - t.length / 100;
}

/**
 * Rank items by how well `key(item)` matches the query.
 *
 * Stable: equal scores keep their original order, which is what makes the
 * palette's first frame -- an empty query -- show the list in the order the
 * caller assembled it rather than in an arbitrary one.
 *
 * @template T
 * @param {T[]} items
 * @param {string} query
 * @param {(item: T) => string} key
 * @returns {T[]}
 */
export function rank(items, query, key) {
  const scored = items.map((item, i) => ({ item, i, s: score(query, key(item)) }));
  return scored
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}
