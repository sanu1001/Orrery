// @ts-check
/**
 * Topology for the tree renderer.
 *
 * THERE IS NO EDGE LIST IN A TRACE. Edges are read back out of state: a pointer
 * field holding a ref IS an edge, and it stops being one the moment that write
 * is undone. Rewind correctness is inherited rather than maintained, because
 * there is no second record of the topology to fall out of sync with the first.
 * ADR 0004, RENDERERS/TREE.md 1.
 *
 * The consequence worth stating: a MALFORMED tree still renders. A node with
 * two parents, a pointer into a node that no longer exists, a cycle -- each
 * draws, and draws wrong, which is exactly what you want when the algorithm
 * that produced it is the thing you are debugging.
 *
 * No DOM, no React: this is tested in Node by scripts/tree.test.mjs.
 */

const DEFAULT_ORDER = ['left', 'right'];

/**
 * @typedef {object} Shape
 * @property {string[]} ids        ordinal -> node id; '' marks a PHANTOM slot
 * @property {number[][]} kids     ordinal -> child ordinals, in declared order
 * @property {number[]} roots
 * @property {Map<string,number>} ordOf
 * @property {number[]} parent     ordinal -> parent ordinal, -1 at a root
 * @property {Array<{from:number,to:number,field:string}>} back     cycle edges
 * @property {Array<{from:number,to:number,field:string}>} extra    second-parent edges
 * @property {Array<{from:number,field:string,target:string,slot:number}>} dangling
 * @property {Set<number>} danglingSlots  phantom ordinals already occupied by a stub
 * @property {Set<string>} multiParent
 */

/** @param {string} id @param {string} field */
export const edgeKey = (id, field) => `${id}|${field}`;

/**
 * The edge set as of RIGHT NOW, straight out of state.
 *
 * @param {*} struct  a Struct of kind 'nodes'
 * @param {string[]} fields the declared ptr fields
 * @returns {Map<string,string>} "id|field" -> target id
 */
export function currentEdges(struct, fields) {
  const out = new Map();
  if (!struct) return out;
  for (const id of struct.nodeIDs()) {
    if (!struct.exists(id)) continue;
    for (const f of fields) {
      const v = struct.get([id, f]);
      if (v && typeof v === 'object' && typeof v.$ === 'string') {
        out.set(edgeKey(id, f), v.$);
      }
    }
  }
  return out;
}

/**
 * The edge set the layout is built from: the LAST value each pointer field ever
 * holds, i.e. the tree's final shape.
 *
 * Last-write-wins rather than "every edge that ever existed" because a union of
 * all of them is not a tree — a rotation writes `left` twice and the node would
 * come out with two left children. RENDERERS/TREE.md 3.1.
 *
 * @param {*} union structUnion entry for this structure
 * @param {string[]} fields
 * @returns {Map<string,string>}
 */
export function finalEdges(union, fields) {
  const keep = new Set(fields);
  const out = new Map();
  for (const [from, field, to] of union?.edges ?? []) {
    if (keep.has(field)) out.set(edgeKey(from, field), to);
  }
  return out;
}

/**
 * Does `layoutEdges` already account for every edge in `now`?
 *
 * This is the question that decides whether the layout can be reused, and it is
 * a SUBSET test rather than an equality test on purpose. A growing tree is
 * always a subset of its own final shape, so it lays out exactly once and
 * nothing ever moves — which is the entire static-skeleton guarantee. Only a
 * contradiction (a pointer now aiming somewhere the final shape does not have
 * it aim) forces a recompute, and a rotation is precisely that. There the
 * movement is correct: a rotation IS movement. RENDERERS/TREE.md 3.1.
 *
 * @param {Map<string,string>} now
 * @param {Map<string,string>} layoutEdges
 */
export function layoutCovers(now, layoutEdges) {
  for (const [k, v] of now) {
    if (layoutEdges.get(k) !== v) return false;
  }
  return true;
}

/**
 * Turn a node set and an edge map into something tidyTree can lay out.
 *
 * Two things happen here that are not just graph traversal:
 *
 * PHANTOM SLOTS. A node with one child gets an empty slot where the other
 * would be, so it visibly LEANS. Reingold-Tilford would otherwise centre the
 * only child under its parent, and for a BST that is a lie about the data:
 * "there is nothing to the left" is the fact the next descent turns on. Slots
 * go only to nodes that have SOMETHING below them — a child, a dangling
 * pointer, a back edge — so a leaf costs nothing and a complete tree gets no
 * phantoms at all.
 *
 * CYCLE BREAKING. RT does not terminate on a cyclic graph. The first time a
 * student's insert links a node to itself, an unguarded layout hangs the tab
 * and reads as the app crashing; a detected cycle drawn as a dashed back edge
 * reads as a feature. RENDERERS/TREE.md 6.
 *
 * @param {string[]} nodeIds every node that should be positioned
 * @param {Map<string,string>} edges
 * @param {string[]} [order] declared child order
 * @returns {Shape}
 */
export function buildShape(nodeIds, edges, order) {
  const fields = order && order.length ? order : DEFAULT_ORDER;
  const exists = new Set(nodeIds);

  const indeg = new Map(nodeIds.map((id) => [id, 0]));
  for (const id of nodeIds) {
    for (const f of fields) {
      const t = edges.get(edgeKey(id, f));
      if (t && exists.has(t)) indeg.set(t, (indeg.get(t) ?? 0) + 1);
    }
  }

  /** @type {string[]} */ const ids = [];
  /** @type {number[][]} */ const kids = [];
  /** @type {number[]} */ const parent = [];
  const ordOf = new Map();
  const roots = [];
  const back = [];
  const extra = [];
  const dangling = [];
  const multiParent = new Set();
  const danglingSlots = new Set();
  const seen = new Set();

  const push = (id, par) => {
    const ord = ids.length;
    ids.push(id);
    kids.push([]);
    parent.push(par);
    if (id) ordOf.set(id, ord);
    return ord;
  };

  const isAncestor = (a, of) => {
    for (let c = of; c >= 0; c = parent[c]) if (c === a) return true;
    return false;
  };

  // Iterative, like both walks in tidyTree. A recursive descent here blows the
  // stack on the degenerate tree — insert a sorted list into a BST and the
  // "tree" is a spine as deep as the input.
  const stack = [];
  const seedFrom = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const o = push(id, -1);
    roots.push(o);
    stack.push(o);
    drain();
  };

  function drain() {
    while (stack.length) {
      const ord = stack.pop();
      const id = ids[ord];
      if (!id) continue;

      // Every slot is classified BEFORE any is placed, because whether the
      // empty ones become phantoms depends on whether any sibling is real.
      const slots = fields.map((f) => {
        const t = edges.get(edgeKey(id, f));
        if (t === undefined || t === null) return { f, t: '', kind: 'empty' };
        if (!exists.has(t)) return { f, t, kind: 'dangling' };
        if (seen.has(t)) return { f, t, kind: 'revisit' };
        return { f, t, kind: 'child' };
      });
      // "Has anything below it", not "has a real child". A dangling pointer and
      // a back edge are both drawn, so they occupy their slot as surely as a
      // child does -- and the sibling must not slide into the middle. Only a
      // node with nothing at all below it is a leaf, and a leaf costs no slots.
      const anyBelow = slots.some((s) => s.kind !== 'empty');

      for (const s of slots) {
        // Re-checked at PLACEMENT time, not just at classification time. Two
        // slots of the same node can name the same target -- `left` and `right`
        // both pointing at n2 -- and the up-front pass cannot see the first one
        // claim it, because none of them have been placed yet. Without this the
        // node is pushed twice, drawn twice, and its second parent goes
        // unreported: the duplicate looks like a sibling instead of a bug.
        if (s.kind === 'child' && seen.has(s.t)) s.kind = 'revisit';

        if (s.kind === 'child') {
          seen.add(s.t);
          const o = push(s.t, ord);
          kids[ord].push(o);
          stack.push(o);
          continue;
        }
        if (s.kind === 'dangling') {
          // The slot ordinal travels with the record so the stub is drawn where
          // the layout actually reserved room for it, rather than at a guessed
          // offset that drifts as soon as the node width changes.
          const slot = push('', ord);
          danglingSlots.add(slot);
          dangling.push({ from: ord, field: s.f, target: s.t, slot });
          kids[ord].push(slot);
          continue;
        }
        if (s.kind === 'revisit') {
          const to = ordOf.get(s.t);
          if (to !== undefined) {
            // An ancestor means the edge closes a loop. Anything else already
            // has a parent, so this is a second one — a bug in the algorithm,
            // and drawing both edges is how it becomes visible.
            if (isAncestor(to, ord) || to === ord) back.push({ from: ord, to, field: s.f });
            else { extra.push({ from: ord, to, field: s.f }); multiParent.add(s.t); }
          }
        } else if (!anyBelow) {
          continue; // a leaf gets no slots
        }
        kids[ord].push(push('', ord));
      }
    }
  }

  for (const id of nodeIds) if ((indeg.get(id) ?? 0) === 0) seedFrom(id);
  // Anything still unseen sits in a component with no entry point — every node
  // in it has a parent, which only happens inside a cycle. Seeding from the
  // first such node lets the back-edge detection above break it.
  for (const id of nodeIds) seedFrom(id);

  return { ids, kids, roots, ordOf, parent, back, extra, dangling, multiParent, danglingSlots };
}
