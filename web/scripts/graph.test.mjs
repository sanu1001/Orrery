#!/usr/bin/env node
/**
 * Graph layout and topology tests.
 *
 * The layout functions are where the bugs are and they are pure, which is
 * exactly the split RENDERERS/00-OVERVIEW.md 8 asks for: test the placement,
 * not the SVG. Every acceptance item in RENDERERS/GRAPH.md that does not need
 * eyes is below; the ones that do are worked by hand in the browser.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, neighbourhood, components, orientEdge, edgeKey }
  from '../src/render/layout/graphShape.js';
import { graphLayout, mulberry32, MAX_NODES } from '../src/render/layout/graphLayout.js';
import { buildIndex } from '../src/player/prepass.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

/** A structUnion-shaped stand-in, which is all buildGraph reads. */
const union = (schema, extra = {}) => ({ kind: 'graph', schema, nodeIds: [], edges: [], ...extra });
const E = (u, v, w) => ({ u, v, w });

// --- the cross-language edge-key contract -----------------------------------
// Go writes every edge attribute at the oriented key and this reads it back. A
// disagreement renders every weight blank rather than failing loudly, so it is
// worth an explicit test on both orientations.
{
  check('an undirected edge orients the same way from either end',
    edgeKey(...orientEdge('b', 'a', false)) === edgeKey(...orientEdge('a', 'b', false)),
    edgeKey(...orientEdge('b', 'a', false)));
  check('and the orientation is lexicographic, matching trace.OrientEdge',
    edgeKey(...orientEdge('b', 'a', false)) === 'a|b');
  check('a directed edge keeps the direction it was given',
    edgeKey(...orientEdge('b', 'a', true)) === 'b|a');
}

// --- determinism ------------------------------------------------------------
// "The same seed produces a pixel-identical layout on every load." Two runs of
// the force layout over the same graph must agree bit for bit, or a share link
// draws a different picture than the one that was shared.
{
  const g = buildGraph(union({
    nodes: ['a', 'b', 'c', 'd', 'e', 'f'], layoutHint: 'force',
    edges: [E('a', 'b', 1), E('b', 'c', 2), E('c', 'd', 3), E('d', 'e', 1), E('e', 'f', 4), E('a', 'f', 2)],
  }));
  const dump = (l) => [...l.pos.entries()].map(([k, p]) => `${k}:${p.x},${p.y}`).join(' ');
  const a = graphLayout(g, 12345);
  const b = graphLayout(g, 12345);
  check('the same seed lays the same graph out identically', dump(a) === dump(b));
  check('and a different seed does not', dump(a) !== dump(graphLayout(g, 999)));
  check('the strategy actually used is reported', a.strategy === 'force', a.strategy);

  let bits = 0;
  const r = mulberry32(1);
  for (let i = 0; i < 1000; i++) { const v = r(); if (v < 0 || v >= 1) bits++; }
  check('the PRNG stays inside [0,1)', bits === 0);
  check('and two generators from one seed agree',
    mulberry32(7)() === mulberry32(7)());
}

// --- grid: a maze must not become a blob ------------------------------------
{
  const nodes = [];
  const edges = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      nodes.push(`${r},${c}`);
      if (c + 1 < 4) edges.push(E(`${r},${c}`, `${r},${c + 1}`, 1));
      if (r + 1 < 3) edges.push(E(`${r},${c}`, `${r + 1},${c}`, 1));
    }
  }
  const l = graphLayout(buildGraph(union({ nodes, edges, layoutHint: 'grid' })), 1);
  check('a grid-derived graph uses the grid strategy', l.strategy === 'grid', l.strategy);

  const p = (r, c) => l.pos.get(`${r},${c}`);
  check('every row shares one y', new Set(nodes.filter((n) => n.startsWith('1,'))
    .map((n) => l.pos.get(n).y)).size === 1);
  check('every column shares one x', new Set(nodes.filter((n) => n.endsWith(',2'))
    .map((n) => l.pos.get(n).x)).size === 1);
  check('columns advance left to right', p(0, 0).x < p(0, 1).x && p(0, 1).x < p(0, 2).x);
  check('rows advance top to bottom', p(0, 0).y < p(1, 0).y && p(1, 0).y < p(2, 0).y);
  check('and the spacing is uniform',
    p(0, 1).x - p(0, 0).x === p(0, 3).x - p(0, 2).x);

  // A grid hint on ids that carry no coordinates is a producer bug. Rule 3 of
  // the renderer contract says degrade, never throw.
  const bad = graphLayout(buildGraph(union({
    nodes: ['a', 'b', 'c'], edges: [E('a', 'b', 1)], layoutHint: 'grid',
  })), 1);
  check('a grid hint on unparseable ids falls back instead of throwing',
    bad.strategy !== 'grid' && bad.pos.size === 3, bad.strategy);
}

// --- layered: a DAG must read as its layers ---------------------------------
{
  // b and c both depend on a; d depends on b and c; e depends only on a but is
  // ALSO reachable a->b->d->e, so longest-path depth is what puts it below d.
  const edges = [E('a', 'b'), E('a', 'c'), E('b', 'd'), E('c', 'd'), E('d', 'e'), E('a', 'e')];
  const g = buildGraph(union({
    nodes: ['a', 'b', 'c', 'd', 'e'], edges, directed: true, layoutHint: 'layered',
  }));
  const l = graphLayout(g, 1);
  check('a DAG uses the layered strategy', l.strategy === 'layered', l.strategy);

  const y = (id) => l.pos.get(id).y;
  check('every edge points strictly down a layer',
    edges.every((e) => y(e.u) < y(e.v)),
    edges.filter((e) => y(e.u) >= y(e.v)).map((e) => `${e.u}->${e.v}`).join(','));
  // The failure this catches: shortest-path depth would put e on layer 1, and
  // the d->e edge would then travel upwards in a graph with no cycles at all.
  check('longest path, not shortest — e sits below d, not beside b',
    y('e') > y('d'), `e=${y('e')} d=${y('d')}`);
  check('siblings share a layer', y('b') === y('c'));

  // A layered hint on a cyclic graph is a producer bug; hanging the tab is not
  // an acceptable response to one.
  const cyc = graphLayout(buildGraph(union({
    nodes: ['a', 'b', 'c'], directed: true, layoutHint: 'layered',
    edges: [E('a', 'b'), E('b', 'c'), E('c', 'a')],
  })), 1);
  check('a cycle under a layered hint terminates and still places every node',
    cyc.pos.size === 3);
}

// --- circle -----------------------------------------------------------------
{
  const g = buildGraph(union({ nodes: ['a', 'b', 'c', 'd'], edges: [E('a', 'b')] }));
  const l = graphLayout(g, 1);
  check('a small graph with no hint goes round a circle', l.strategy === 'circle', l.strategy);
  const c = { x: l.w / 2, y: l.h / 2 };
  const rad = [...l.pos.values()].map((p) => Math.hypot(p.x - c.x, p.y - c.y));
  check('every node is the same distance from the centre',
    Math.max(...rad) - Math.min(...rad) < 1e-6);
  check('declaration order runs clockwise from the top',
    l.pos.get('a').y < l.pos.get('c').y && l.pos.get('b').x > l.pos.get('d').x);

  const big = buildGraph(union({
    nodes: Array.from({ length: 20 }, (_, i) => `n${i}`), edges: [],
  }));
  check('past twelve nodes the default becomes force',
    graphLayout(big, 1).strategy === 'force');
}

// --- disconnected components must all be on screen --------------------------
{
  const g = buildGraph(union({
    nodes: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm'],
    layoutHint: 'force',
    edges: [E('a', 'b'), E('b', 'c'), E('d', 'e'), E('e', 'f'), E('g', 'h'), E('h', 'i'),
            E('i', 'g'), E('j', 'k'), E('k', 'l'), E('l', 'm')],
  }));
  check('components are found over the undirected reading', components(g).length === 4,
    `${components(g).length}`);
  const l = graphLayout(g, 2024);
  const inside = [...l.pos.values()].every((p) =>
    p.x >= 0 && p.y >= 0 && p.x <= l.w && p.y <= l.h);
  check('every node of every component lands inside the reported box', inside);
  // Packing is the point: without it force pushes the components apart with
  // nothing pulling back, and the camera shrinks the survivor to nothing.
  const spread = Math.max(...[...l.pos.values()].map((p) => p.x));
  check('and the box is wide enough to have held them all', l.w >= spread, `${l.w} >= ${spread}`);
}

// --- parallel edges, self loops, and the neighbourhood ----------------------
{
  const g = buildGraph(union({
    nodes: ['a', 'b', 'c'], directed: true,
    edges: [E('a', 'b', 1), E('b', 'a', 2), E('a', 'c', 3), E('c', 'c', 4)],
  }));
  const lanes = g.edges.filter((e) => e.u !== e.v && (e.u === 'a' || e.v === 'a') && (e.u === 'b' || e.v === 'b'))
    .map((e) => e.lane);
  check('two edges between the same pair take opposite lanes',
    lanes.length === 2 && lanes[0] === -lanes[1] && lanes[0] !== 0, lanes.join(','));
  check('a lone edge is never offset', g.edges.find((e) => e.v === 'c' && e.u === 'a').lane === 0);
  check('a self loop is flagged rather than drawn as a zero-length line',
    g.edges.find((e) => e.u === 'c' && e.v === 'c').loop === true);

  const nb = neighbourhood(g, 'a');
  check('the active set is the cursor plus what it points at',
    [...nb.nodes].sort().join(',') === 'a,b,c', [...nb.nodes].sort().join(','));
  // Out-edges only, and the incoming b->a is deliberately left in context: b is
  // not in the active NODE set, so lighting the edge would draw a bright line
  // to a dimmed circle and claim work that is not happening.
  check('and the active edges are the ones leaving it', nb.edges.size === 2, `${nb.edges.size}`);
  check('the edge arriving at the cursor stays in context',
    ![...nb.edges].some((i) => g.edges[i].u === 'b' && g.edges[i].v === 'a'));
  check('a directed graph lights out-neighbours only',
    !neighbourhood(g, 'c').nodes.has('a'));

  const und = buildGraph(union({
    nodes: ['a', 'b', 'c'], edges: [E('a', 'b', 1), E('c', 'a', 2)],
  }));
  check('undirected, both ends of an edge count as leaving it',
    neighbourhood(und, 'a').edges.size === 2);
  check('no cursor means nothing is at full strength', neighbourhood(g, null).nodes.size === 0);
}

// --- degrade, never throw ---------------------------------------------------
{
  check('an empty graph reports an empty layout', graphLayout(buildGraph(union({})), 1).pos.size === 0);
  check('a union with no schema at all survives', buildGraph(undefined).nodes.length === 0);
  check('a single node is placed rather than divided by zero',
    graphLayout(buildGraph(union({ nodes: ['a'] })), 1).pos.size === 1);
  // An edge naming a node the schema forgot: keep the edge and adopt the node,
  // because dropping it would silently hide a real relationship.
  const g = buildGraph(union({ nodes: ['a'], edges: [E('a', 'z', 1)] }));
  check('an edge to an undeclared node adopts the node', g.nodes.join(',') === 'a,z');
}

// --- kind:"nodes" graphs come from ptr triples instead of a declaration -----
{
  const g = buildGraph({
    kind: 'nodes', schema: { fields: { next: 'ptr', other: 'ptr' } },
    nodeIds: ['n0', 'n1', 'n2'], edges: [['n0', 'next', 'n1'], ['n1', 'other', 'n2']],
  });
  check('ptr-derived edges build the same graph shape',
    g.nodes.length === 3 && g.edges.length === 2);
  check('and the pointer field name is dropped — a graph draws a line',
    g.edges.every((e) => e.w === null));
}

// --- scale ------------------------------------------------------------------
{
  const n = MAX_NODES;
  const nodes = Array.from({ length: n }, (_, i) => `n${i}`);
  const edges = [];
  let r = mulberry32(5);
  for (let i = 1; i < n; i++) edges.push(E(nodes[Math.floor(r() * i)], nodes[i], 1));
  while (edges.length < 100) {
    const a = Math.floor(r() * n), b = Math.floor(r() * n);
    if (a !== b) edges.push(E(nodes[a], nodes[b], 1));
  }
  const g = buildGraph(union({ nodes, edges, layoutHint: 'force' }));
  const t0 = performance.now();
  const l = graphLayout(g, 1);
  const ms = performance.now() - t0;
  // Once, at load, not per frame -- so the budget is generous. The number is
  // here to catch an accidental O(n^3), not to police milliseconds.
  check('40 nodes and 100 edges lay out in well under a second',
    ms < 500, `${ms.toFixed(1)}ms`);
  check('and the radius drops past twenty nodes so the labels still fit',
    l.r === 14, `${l.r}`);
  check('every one of them got a position', l.pos.size === n);
}

// --- against the real trace -------------------------------------------------
// The union the renderer actually receives comes out of the pre-pass, not out
// of a literal in this file. Anything that only works on a hand-built union is
// not working.
{
  const dir = fileURLToPath(new URL('../../testdata/golden/', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.startsWith('dijkstra'));
  if (files.length === 0) {
    check('a golden dijkstra trace exists to lay out', false, 'run `make golden`');
  } else {
    const tr = JSON.parse(readFileSync(join(dir, files[0]), 'utf8'));
    const idx = buildIndex(tr, 0);
    const view = tr.meta.views.find((v) => v.family === 'graph');
    const g = buildGraph(idx.structUnion.get(view.s));
    check('the pre-pass union yields the declared node set',
      g.nodes.length === 8 && g.weighted === true, `${g.nodes.length} nodes`);
    check('and every declared edge carries its weight',
      g.edges.length > 0 && g.edges.every((e) => typeof e.w === 'number'));
    const l = graphLayout(g, tr.meta.seed ?? 0);
    check('which lays out with every node inside the box',
      [...l.pos.values()].every((p) => p.x >= 0 && p.y >= 0 && p.x <= l.w && p.y <= l.h));
    check('the view names the structures the renderer reads',
      view.options.distOf === 'dist' && view.options.settledOf === 'done' &&
      view.options.queueOf === 'pq' && view.options.predOf === 'pred');
  }
}

console.log(failures === 0 ? '\ngraph: all checks passed' : `\ngraph: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
