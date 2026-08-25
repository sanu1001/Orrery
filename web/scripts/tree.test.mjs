#!/usr/bin/env node
/**
 * Layout-input tests for the node renderers.
 *
 * tidytree.test.mjs covers the tidy-tree ALGORITHM — parents centred, no
 * overlaps, a 5,000-deep spine. This covers what is fed into the renderers:
 * which nodes are children of which, where the empty slots go, the malformed
 * shapes that have to render rather than throw or hang, and the serpentine
 * placement lists use instead.
 */

import { buildShape, finalEdges, currentEdges, layoutCovers, edgeKey }
  from '../src/render/layout/treeShape.js';
import { tidyTree } from '../src/render/layout/tidyTree.js';
import { chainOrder, serpentine, reachable }
  from '../src/render/layout/serpentine.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const ORDER = ['left', 'right'];
/** @param {Array<[string,string,string]>} pairs */
const edges = (pairs) => new Map(pairs.map(([f, k, t]) => [edgeKey(f, k), t]));

// --- the declared order beats insertion order -------------------------------
// The case the schema's `order` field exists for. n2 is written FIRST and is
// the right child; if draw order came from insertion it would appear on the
// left and the picture would contradict the code.
{
  const e = edges([['n0', 'right', 'n2'], ['n0', 'left', 'n1']]);
  const s = buildShape(['n0', 'n2', 'n1'], e, ORDER);
  const [l, r] = s.kids[s.ordOf.get('n0')];
  check('a right child written first is still drawn on the right',
    s.ids[l] === 'n1' && s.ids[r] === 'n2', `${s.ids[l]} | ${s.ids[r]}`);

  const layout = tidyTree({ kids: s.kids, roots: s.roots, depth: [] }, 40, 40);
  check('and it is laid out to the right of its sibling',
    layout.x[l] < layout.x[r], `${layout.x[l]} < ${layout.x[r]}`);
}

// --- a single child leans ----------------------------------------------------
{
  const s = buildShape(['n0', 'n1'], edges([['n0', 'left', 'n1']]), ORDER);
  const root = s.ordOf.get('n0');
  check('a node with only a left child gets two slots, not one child centred',
    s.kids[root].length === 2, `${s.kids[root].length} slots`);
  const [l, r] = s.kids[root];
  check('the phantom is the empty slot, on the right',
    s.ids[l] === 'n1' && s.ids[r] === '', `${s.ids[l]} | "${s.ids[r]}"`);

  const layout = tidyTree({ kids: s.kids, roots: s.roots, depth: [] }, 40, 40);
  check('so the only child is drawn LEFT of its parent, visibly leaning',
    layout.x[l] < layout.x[root], `child ${layout.x[l]} < parent ${layout.x[root]}`);
}

// --- leaves cost nothing -----------------------------------------------------
{
  const s = buildShape(['n0'], new Map(), ORDER);
  check('a lone leaf gets no phantom slots', s.kids[0].length === 0, `${s.kids[0].length}`);

  // A complete tree: every internal node has both children, so no phantoms at
  // all. This is what keeps slots from doubling the width of a normal tree.
  const ids = [], pairs = [];
  for (let i = 0; i < 31; i++) ids.push(`n${i}`);
  for (let i = 0; i < 15; i++) {
    pairs.push([`n${i}`, 'left', `n${2 * i + 1}`], [`n${i}`, 'right', `n${2 * i + 2}`]);
  }
  const c = buildShape(ids, edges(pairs), ORDER);
  check('a complete 31-node tree needs no phantom slots at all',
    c.ids.filter((x) => x === '').length === 0 && c.ordOf.size === 31,
    `${c.ids.length} ordinals for 31 nodes`);

  const layout = tidyTree({ kids: c.kids, roots: c.roots, depth: [] }, 40, 40, 16, 24);
  const xs = [...c.ordOf.values()].map((o) => layout.x[o]);
  check('and it lays out without two nodes landing on the same spot',
    new Set(xs.map((x, i) => `${x}:${layout.y[[...c.ordOf.values()][i]]}`)).size === 31);
}

// --- a cycle must not hang ---------------------------------------------------
// The one worth building early. The first time a student's insert links a node
// to itself, an unguarded Reingold-Tilford never terminates, the tab locks, and
// it reads as the app crashing rather than as their bug.
{
  const s = buildShape(['n0', 'n1'],
    edges([['n0', 'left', 'n1'], ['n1', 'left', 'n0']]), ORDER);
  check('a two-node cycle terminates and reports a back edge',
    s.back.length === 1 && s.ordOf.size === 2, `${s.back.length} back edges`);

  const self = buildShape(['n0'], edges([['n0', 'left', 'n0']]), ORDER);
  check('a self-loop terminates and reports a back edge',
    self.back.length === 1, `${self.back.length}`);

  // Every node has a parent, so there is no indegree-0 node to start from.
  const ring = buildShape(['n0', 'n1', 'n2'],
    edges([['n0', 'left', 'n1'], ['n1', 'left', 'n2'], ['n2', 'left', 'n0']]), ORDER);
  check('a closed ring with no root still places every node',
    ring.ordOf.size === 3 && ring.back.length === 1,
    `${ring.ordOf.size} placed, ${ring.back.length} back`);
}

// --- malformed shapes render, and render wrong -------------------------------
{
  const two = buildShape(['n0', 'n1', 'n2'],
    edges([['n0', 'left', 'n2'], ['n1', 'left', 'n2']]), ORDER);
  check('a node with two parents is flagged rather than deduped',
    two.multiParent.has('n2') && two.extra.length === 1,
    `${two.extra.length} extra edge(s)`);

  // Both slots of ONE node aiming at the same child. The classification pass
  // runs before any slot is placed, so neither sees the other claim n1 -- and
  // the node ends up positioned twice unless placement re-checks.
  const twice = buildShape(['n0', 'n1'],
    edges([['n0', 'left', 'n1'], ['n0', 'right', 'n1']]), ORDER);
  check('a node named by both slots of one parent is placed exactly once',
    twice.ordOf.size === 2 && twice.ids.filter((x) => x === 'n1').length === 1,
    `${twice.ids.filter((x) => x === 'n1').length} placements`);
  check('and the duplicate reads as a second parent, not as a sibling',
    twice.multiParent.has('n1') && twice.extra.length === 1,
    `${twice.extra.length} extra, back=${twice.back.length}`);

  const dang = buildShape(['n0'], edges([['n0', 'right', 'n9']]), ORDER);
  check('a pointer into a node that does not exist is reported as dangling',
    dang.dangling.length === 1 && dang.dangling[0].target === 'n9');
  check('and its slot is still reserved, so the sibling does not slide',
    dang.kids[0].length === 2, `${dang.kids[0].length}`);
}

// --- the static-skeleton guarantee ------------------------------------------
// The property the whole renderer rests on: while a tree only GROWS, its edge
// set stays a subset of the final shape, so the layout is computed once and no
// node ever moves. Only a contradiction — a rotation — forces a recompute.
{
  const union = { edges: [['n0', 'left', 'n1'], ['n0', 'right', 'n2'], ['n1', 'left', 'n3']] };
  const fin = finalEdges(union, ORDER);
  check('the layout edge set is the last write per field',
    fin.size === 3 && fin.get(edgeKey('n1', 'left')) === 'n3');

  const growing = [
    new Map(),
    edges([['n0', 'left', 'n1']]),
    edges([['n0', 'left', 'n1'], ['n0', 'right', 'n2']]),
    edges([['n0', 'left', 'n1'], ['n0', 'right', 'n2'], ['n1', 'left', 'n3']]),
  ];
  check('every state of a growing tree reuses the one layout',
    growing.every((g) => layoutCovers(g, fin)));

  // A rotation aims `left` somewhere the final shape does not, so the layout
  // cannot be reused -- and should not be. A rotation IS movement.
  const rotated = edges([['n0', 'left', 'n3'], ['n0', 'right', 'n2']]);
  check('a rotation is correctly detected as a different shape',
    !layoutCovers(rotated, fin));
}

// --- reading edges out of state ---------------------------------------------
// There is no edge list in a trace. This is the whole topology model.
{
  const struct = {
    _n: { n0: { val: 1, left: { $: 'n1' }, right: null }, n1: { val: 2, left: null, right: null } },
    nodeIDs() { return Object.keys(this._n); },
    exists(id) { return this._n[id] != null; },
    get([id, f]) { return this._n[id]?.[f] ?? null; },
  };
  const now = currentEdges(struct, ORDER);
  check('an edge is a pointer field holding a ref, and nothing else',
    now.size === 1 && now.get(edgeKey('n0', 'left')) === 'n1', `${now.size} edge(s)`);

  // Undoing the write is all it takes; there is no second record to update.
  struct._n.n0.left = null;
  check('undoing that write removes the edge, with nothing else to keep in sync',
    currentEdges(struct, ORDER).size === 0);
}

// --- serpentine: the layout lists use instead of tidy-tree -----------------
// A list is a tree of branching factor one, so RT runs on it and draws a
// vertical column. These cover the left-to-right placement that replaces it.
{
  const order = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const pos = serpentine(order, 3);
  const at = (id) => pos.get(id);

  check('the first row runs left to right',
    at('a').col === 0 && at('b').col === 1 && at('c').col === 2);
  // Boustrophedon: without it the wrap needs one long arrow flying back across
  // the whole pane, which is what makes a wrapped list unreadable.
  check('the second row runs right to left',
    at('d').row === 1 && at('d').col === 2 && at('e').col === 1 && at('f').col === 0,
    `d=${at('d').col} e=${at('e').col} f=${at('f').col}`);
  check('and the third turns back again',
    at('g').row === 2 && at('g').col === 0);
  check('every node lands on exactly one slot',
    new Set(order.map((id) => `${at(id).row}:${at(id).col}`)).size === order.length);
}

// --- order comes from the union, which is why reversal moves no boxes -------
{
  const union = {
    nodeIds: ['n0', 'n1', 'n2'],
    // The FINAL chain is reversed: n2 -> n1 -> n0.
    edges: [['n0', 'next', 'n1'], ['n1', 'next', 'n2'],
            ['n2', 'next', 'n1'], ['n1', 'next', 'n0']],
  };
  check('the default order is creation order, so nothing shifts as pointers move',
    JSON.stringify(chainOrder(union, ['next'])) === JSON.stringify(['n0', 'n1', 'n2']));
  // reflow:"final" is for an algorithm that genuinely reorders nodes, where
  // creation order would cross every arrow.
  check('reflow "final" instead walks the finished chain',
    JSON.stringify(chainOrder(union, ['next'], 'final')) === JSON.stringify(['n2', 'n1', 'n0']),
    chainOrder(union, ['next'], 'final').join(','));

  const loop = { nodeIds: ['n0', 'n1'], edges: [['n0', 'next', 'n1'], ['n1', 'next', 'n0']] };
  check('a final chain that is a closed loop still orders every node once',
    chainOrder(loop, ['next'], 'final').length === 2);
}

// --- reachability, which is what dims a detached node -----------------------
{
  const mk = (links) => ({
    _n: Object.fromEntries(Object.entries(links).map(([id, nx]) =>
      [id, { val: id, next: nx ? { $: nx } : null }])),
    nodeIDs() { return Object.keys(this._n); },
    exists(id) { return this._n[id] != null; },
    get([id, f]) { return this._n[id]?.[f] ?? null; },
  });

  const s1 = mk({ n0: 'n1', n1: null, n2: null });
  check('a node no pointer reaches is detached, not missing',
    !reachable(s1, ['next'], { head: 'n0' }).has('n2'));
  check('and everything the chain does reach is live',
    reachable(s1, ['next'], { head: 'n0' }).size === 2);
  // Mid-reversal both halves are held by different refs; walking from all of
  // them is what stops the list dimming itself in half.
  check('every named pointer seeds the walk, not just head',
    reachable(s1, ['next'], { head: 'n0', cur: 'n2' }).size === 3);

  const cyc = mk({ n0: 'n1', n1: 'n0' });
  check('a cycle terminates instead of spinning',
    reachable(cyc, ['next'], { head: 'n0' }).size === 2);
}

console.log(failures === 0 ? '\ntree: all checks passed' : `\ntree: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
