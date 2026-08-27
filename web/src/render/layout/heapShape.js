// @ts-check

/**
 * The array/tree duality: implicit children.
 *
 * A binary heap IS an array. So is a segment tree. Neither gets a `nodes`
 * structure, and that is a deliberate refusal rather than an omission: giving
 * them node identity would be a lie about the data structure, and the trace
 * would then carry a topology the algorithm never wrote.
 *
 * What they get instead is a second READING of the same array. Children are
 * `2i+1` and `2i+2`, which is arithmetic on an index, not knowledge of an
 * algorithm -- the renderer learns nothing about heaps by knowing it, the same
 * way it learns nothing about grids by knowing `[r, c]`. RENDERERS/LINEAR.md
 * 5.1.
 *
 * The shape comes from the DECLARED length, so it is fixed before the first
 * frame and a sift is a value moving between two positions that never move.
 * That is the right mental model for a heap, and it falls out of the
 * static-skeleton rule with no extra machinery.
 */

/**
 * @param {number} n declared array length
 * @param {number} [arity]
 * @returns {{kids: number[][], roots: number[]}}
 */
export function heapShape(n, arity = 2) {
  const len = Math.max(0, n | 0);
  const k = Math.max(2, arity | 0);
  /** @type {number[][]} */
  const kids = [];
  for (let i = 0; i < len; i++) {
    const row = [];
    for (let c = k * i + 1; c <= k * i + k; c++) {
      if (c < len) row.push(c);
    }
    kids.push(row);
  }
  // NO PHANTOM SLOT for a missing right child, unlike treeShape.js. A named
  // tree needs one so a lone child visibly leans -- "which side is this on" is
  // a real question there. A heap is COMPLETE by definition, so the only node
  // that can have one child is the last internal one and the child is always
  // the left. There is nothing to disambiguate, and a phantom would draw a slot
  // that the data structure cannot fill.
  return { kids, roots: len > 0 ? [0] : [] };
}

/** The parent of i, or -1 for the root. Used to trace a sift path. */
export function heapParent(i, arity = 2) {
  return i <= 0 ? -1 : Math.floor((i - 1) / Math.max(2, arity | 0));
}

/**
 * Levels as index ranges: [[0,0], [1,2], [3,6], ...].
 *
 * Only the row view needs this -- it draws the level breaks that make an array
 * readable AS a heap without leaving the array. The tree layout gets its own
 * depths from tidyTree.
 */
export function heapLevels(n, arity = 2) {
  const k = Math.max(2, arity | 0);
  const out = [];
  let from = 0, width = 1;
  while (from < n) {
    out.push([from, Math.min(n - 1, from + width - 1)]);
    from += width;
    width *= k;
  }
  return out;
}
