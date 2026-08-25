// @ts-check
import { edgeKey, finalEdges } from './treeShape.js';

/**
 * Layout for linked lists.
 *
 * WHY THIS IS NOT tidyTree. A list is a tree of branching factor one, so
 * Reingold-Tilford runs on it perfectly happily and produces a vertical column.
 * Lists read left to right, so that is the wrong picture however correct the
 * algorithm. RENDERERS/LINKED_LIST.md 1.
 *
 * What IS shared is the layer below: topology comes from `treeShape.js`, whose
 * `currentEdges` reads edges out of pointer fields and knows nothing about
 * shape. Trees and lists disagree about arrangement, not about what an edge is.
 */

/**
 * Node order, and the decision that keeps boxes from sliding around.
 *
 * The default is CREATION order, taken from the union, so every node has its
 * slot before the first frame and nothing ever moves. Reversing a list then
 * leaves the boxes untouched and flips only the arrows — which is exactly what
 * the algorithm does to the data, and the picture says so.
 *
 * `options.reflow: "final"` instead walks the final chain, for an algorithm
 * that genuinely reorders nodes (merging two sorted lists) where creation order
 * would cross every arrow. One option, chosen per algorithm.
 * RENDERERS/LINKED_LIST.md 3.
 *
 * @param {*} union structUnion entry
 * @param {string[]} fields ptr fields, chain field first
 * @param {string} [reflow]
 * @returns {string[]}
 */
export function chainOrder(union, fields, reflow) {
  const ids = union?.nodeIds ?? [];
  if (reflow !== 'final' || ids.length === 0) return ids;

  const chain = fields[0];
  const edges = finalEdges(union, [chain]);
  const targeted = new Set(edges.values());
  const heads = ids.filter((id) => !targeted.has(id));

  const out = [];
  const seen = new Set();
  // `heads` is empty when the final chain is a closed loop; starting anywhere
  // is then as good as anywhere else, and the seen-set stops the walk.
  for (const start of heads.length ? heads : [ids[0]]) {
    let cur = start;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      out.push(cur);
      cur = edges.get(edgeKey(cur, chain));
    }
  }
  for (const id of ids) if (!seen.has(id)) out.push(id);
  return out;
}

/**
 * Boustrophedon placement: rows alternate direction.
 *
 * Alternating means the wrap needs a short U-turn at the edge instead of one
 * long arrow flying back across the whole pane, which is the thing that makes a
 * wrapped list unreadable.
 *
 * @param {string[]} order
 * @param {number} perRow
 * @returns {Map<string, {i: number, row: number, col: number}>}
 */
export function serpentine(order, perRow) {
  const n = Math.max(1, perRow);
  const pos = new Map();
  order.forEach((id, i) => {
    const row = Math.floor(i / n);
    const within = i % n;
    pos.set(id, { i, row, col: row % 2 === 0 ? within : n - 1 - within });
  });
  return pos;
}

/**
 * Which nodes are reachable from a named pointer right now.
 *
 * Not decoration: mid-reversal the old head genuinely is unreachable, and
 * showing it dimmed rather than hiding it is what makes the intermediate state
 * legible instead of looking like a node vanished. RENDERERS/LINKED_LIST.md 6.
 *
 * @param {*} struct @param {string[]} fields @param {Object<string,string>} refs
 * @returns {Set<string>}
 */
export function reachable(struct, fields, refs) {
  const seen = new Set();
  if (!struct) return seen;
  const stack = Object.values(refs ?? {}).filter(Boolean);
  while (stack.length) {
    const id = /** @type {string} */ (stack.pop());
    if (!id || seen.has(id) || !struct.exists(id)) continue;
    seen.add(id);
    for (const f of fields) {
      const v = struct.get([id, f]);
      if (v && typeof v === 'object' && typeof v.$ === 'string') stack.push(v.$);
    }
  }
  return seen;
}
