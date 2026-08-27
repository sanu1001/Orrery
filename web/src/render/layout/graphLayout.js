// @ts-check
import { components } from './graphShape.js';

/**
 * Placement for the graph family: four strategies, chosen by PROVENANCE.
 *
 * Force-directed layout is the reflex and it is the wrong default. It is
 * non-deterministic, it jitters, and on a graph that already has obvious
 * structure it destroys the one thing the viewer understood before they
 * started. A maze laid out as a blob is actively worse than useless; a
 * topological sort laid out in layers IS the visualization.
 *
 * So the strategy comes from `schema.layoutHint`, which the ALGORITHM declares
 * in the trace. That is data, not code, so invariant I2 holds: this module
 * never learns which algorithm it is drawing. RENDERERS/GRAPH.md 1.
 */

/** Past this the picture stops being a teaching artifact; the input form caps
 *  below it and the renderer says so rather than drawing something unreadable.
 *  RENDERERS/GRAPH.md 7. */
export const MAX_NODES = 40;

const GRID_CELL = 74;
const LAYER_H = 84;
const LAYER_GAP = 76;
// The force frame is a FUNCTION of the node count, not a constant. A fixed
// 760x520 box meant eight nodes spread over the same area as forty, and since
// the SVG scales to fit its pane, only the ratio of node radius to layout
// extent decides how big a label renders. At a fixed frame an eight-node graph
// came out at 0.63 scale -- 12px type at 7.6px, which fits and cannot be read.
//
// Each node gets a square cell of side 2r + FORCE_GAP, and the frame is that
// total area at a 1.6 landscape aspect, because a pane sharing a column with a
// second view is always wider than it is tall.
const FORCE_GAP = 60;
const FORCE_ASPECT = 1.6;
const FORCE_ITERS = 300;
const COMPONENT_GAP = 56;

/**
 * @typedef {object} Layout
 * @property {Map<string, {x:number, y:number}>} pos
 * @property {number} w
 * @property {number} h
 * @property {number} r         node radius, chosen by node count
 * @property {string} strategy  the one actually used, which may not be the hint
 */

/**
 * @param {import('./graphShape.js').Graph} g
 * @param {number} [seed]
 * @returns {Layout}
 */
export function graphLayout(g, seed = 0x9e3779b9) {
  const n = g.nodes.length;
  const r = n > 20 ? 14 : 20;
  if (n === 0) return { pos: new Map(), w: 0, h: 0, r, strategy: 'empty' };

  let strategy = g.hint;
  /** @type {Map<string, {x:number,y:number}>|null} */
  let pos = null;

  if (strategy === 'grid') pos = gridPositions(g);
  else if (strategy === 'layered') pos = layeredPositions(g);
  else if (strategy === 'circle') pos = circlePositions(g, r);

  // A grid hint on ids that carry no coordinates is a producer bug, not a
  // reason to render nothing. Fall through to the default rather than throw --
  // rule 3 of the renderer contract.
  if (!pos) {
    strategy = n <= 12 && g.hint !== 'force' ? 'circle' : 'force';
    pos = strategy === 'circle' ? circlePositions(g, r) : forcePositions(g, seed, r);
  }

  if (strategy === 'force') {
    // Three post-passes, all of them there to tame the one strategy free to put
    // a node anywhere. Rotating or rescaling a grid or a layered picture would
    // destroy the structure that made it the right choice, so none of them run
    // there.
    packComponents(g, pos);
    rotateHighestDegreeLeft(g, pos);
    // Rotation is what makes this necessary: turning a 760x520 frame through an
    // arbitrary angle gives a bounding box up to its diagonal, 921 wide, and
    // packed components are wider still. Uniform, about the centroid, so the
    // layout keeps its shape and only its scale changes.
    fitInto(pos, frame(g.nodes.length, r));
  }

  return { ...normalize(pos, r * 2), r, strategy };
}

// ---------------------------------------------------------------------------
// grid
// ---------------------------------------------------------------------------

/**
 * A maze or board graph, whose node ids carry their own coordinates.
 *
 * The coordinates are READ OUT OF THE ID rather than declared alongside it: a
 * producer that names its nodes "3,4" has already said where they go, and a
 * parallel coordinate table would be a second source of truth able to disagree
 * with the ids on the same picture. Any id shape works as long as it holds
 * exactly two integers, so "3,4", "r3c4" and "n3_4" all parse.
 *
 * Returns null when they do not, and the caller falls back.
 */
function gridPositions(g) {
  const pos = new Map();
  for (const id of g.nodes) {
    const m = id.match(/\d+/g);
    if (!m || m.length !== 2) return null;
    pos.set(id, { x: Number(m[1]) * GRID_CELL, y: Number(m[0]) * GRID_CELL });
  }
  return pos;
}

// ---------------------------------------------------------------------------
// layered
// ---------------------------------------------------------------------------

/**
 * Sugiyama-lite for a DAG: layer = longest-path depth, order within a layer by
 * the median of the adjacent layer.
 *
 * Longest path, not shortest, because every edge must point down a layer. With
 * shortest-path depth a node reachable in one hop and again in three lands on
 * layer 1, and the three-hop edge then travels upwards -- which reads as a
 * cycle in a graph that has none.
 *
 * Cycles are broken rather than rejected. A `layered` hint on a cyclic graph is
 * a producer bug, and dropping the back edge from the LAYERING while still
 * drawing it degrades honestly: the renderer draws every edge it was given.
 */
function layeredPositions(g) {
  const acyclic = withoutBackEdges(g);
  const layer = longestPathLayers(g.nodes, acyclic);

  /** @type {string[][]} */
  const rows = [];
  for (const id of g.nodes) {
    const L = layer.get(id) ?? 0;
    (rows[L] ??= []).push(id);
  }
  for (let i = 0; i < rows.length; i++) rows[i] ??= [];

  const up = new Map(g.nodes.map((id) => [id, /** @type {string[]} */([])]));
  const down = new Map(g.nodes.map((id) => [id, /** @type {string[]} */([])]));
  for (const [u, v] of acyclic) { down.get(u)?.push(v); up.get(v)?.push(u); }

  // Four sweeps. Two is enough for most graphs and the gain past four is not
  // measurable at n <= 40; the number bounds the work, it is not a convergence
  // criterion.
  for (let sweep = 0; sweep < 4; sweep++) {
    const goingDown = sweep % 2 === 0;
    const order = goingDown
      ? rows.map((_, i) => i).slice(1)
      : rows.map((_, i) => i).slice(0, -1).reverse();
    for (const i of order) {
      const ref = positionsIn(rows[goingDown ? i - 1 : i + 1]);
      const neighbours = goingDown ? up : down;
      const cur = positionsIn(rows[i]);
      rows[i] = [...rows[i]].sort((a, b) => {
        const ma = median(neighbours.get(a) ?? [], ref, cur.get(a) ?? 0);
        const mb = median(neighbours.get(b) ?? [], ref, cur.get(b) ?? 0);
        // Current index as the tie-break, so a node with no neighbour in the
        // adjacent layer stays where it is instead of drifting every sweep.
        return ma - mb || (cur.get(a) ?? 0) - (cur.get(b) ?? 0);
      });
    }
  }

  const pos = new Map();
  rows.forEach((row, L) => {
    row.forEach((id, i) => {
      pos.set(id, { x: (i - (row.length - 1) / 2) * LAYER_GAP, y: L * LAYER_H });
    });
  });
  return pos;
}

/**
 * Directed edges with back edges removed, found by an iterative three-colour
 * DFS. Same cycle-breaking shape as treeShape.js and for the same reason: a
 * malformed input must degrade, never hang the tab.
 */
function withoutBackEdges(g) {
  const out = new Map(g.nodes.map((id) => [id, /** @type {string[]} */([])]));
  for (const e of g.edges) {
    if (e.loop) continue;
    out.get(e.u)?.push(e.v);
  }
  const colour = new Map(g.nodes.map((id) => [id, 0])); // 0 white, 1 grey, 2 black
  /** @type {Array<[string,string]>} */
  const kept = [];
  for (const root of g.nodes) {
    if (colour.get(root) !== 0) continue;
    /** @type {Array<{id:string, i:number}>} */
    const stack = [{ id: root, i: 0 }];
    colour.set(root, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const kids = out.get(top.id) ?? [];
      if (top.i >= kids.length) { colour.set(top.id, 2); stack.pop(); continue; }
      const v = kids[top.i++];
      if (colour.get(v) === 1) continue; // a back edge: dropped from the layering
      kept.push([top.id, v]);
      if (colour.get(v) === 0) { colour.set(v, 1); stack.push({ id: v, i: 0 }); }
    }
  }
  return kept;
}

function longestPathLayers(nodes, edges) {
  const indeg = new Map(nodes.map((id) => [id, 0]));
  const out = new Map(nodes.map((id) => [id, /** @type {string[]} */([])]));
  for (const [u, v] of edges) {
    out.get(u)?.push(v);
    indeg.set(v, (indeg.get(v) ?? 0) + 1);
  }
  const layer = new Map(nodes.map((id) => [id, 0]));
  const queue = nodes.filter((id) => (indeg.get(id) ?? 0) === 0);
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head];
    for (const v of out.get(u) ?? []) {
      layer.set(v, Math.max(layer.get(v) ?? 0, (layer.get(u) ?? 0) + 1));
      indeg.set(v, (indeg.get(v) ?? 0) - 1);
      if ((indeg.get(v) ?? 0) === 0) queue.push(v);
    }
  }
  return layer;
}

const positionsIn = (row) => new Map((row ?? []).map((id, i) => [id, i]));

function median(ids, ref, fallback) {
  const xs = ids.map((id) => ref.get(id)).filter((v) => v !== undefined).sort((a, b) => a - b);
  if (xs.length === 0) return fallback;
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

// ---------------------------------------------------------------------------
// circle
// ---------------------------------------------------------------------------

/** Declaration order around a circle sized so the nodes cannot touch. */
function circlePositions(g, r) {
  const n = g.nodes.length;
  const R = Math.max(90, (n * (r * 2 + 26)) / (2 * Math.PI));
  const pos = new Map();
  if (n === 1) { pos.set(g.nodes[0], { x: 0, y: 0 }); return pos; }
  g.nodes.forEach((id, i) => {
    // Start at the top and go clockwise, so "first declared" is where a reader
    // starts reading.
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    pos.set(id, { x: R * Math.cos(a), y: R * Math.sin(a) });
  });
  return pos;
}

// ---------------------------------------------------------------------------
// force
// ---------------------------------------------------------------------------

/**
 * Fruchterman-Reingold, run offline and then FROZEN.
 *
 * Fruchterman and Reingold, "Graph Drawing by Force-Directed Placement",
 * Software: Practice and Experience, 1991. k = sqrt(area / n), 300 iterations,
 * O(n^2) per iteration -- at n <= 40 that is 480k operations once, at load,
 * which is a few milliseconds. Barnes-Hut would be exactly the premature
 * optimization FLAWS.md 9 warns about, and its trigger is a graph size this
 * renderer refuses to draw anyway.
 *
 * No live simulation, EVER. A live layout means the same share link draws a
 * different picture every time it is opened, which breaks the reproducibility
 * the whole backend is built on. Seeded plus frozen means one seed, one
 * picture, forever.
 */
function forcePositions(g, seed, r) {
  const n = g.nodes.length;
  const rand = mulberry32(seed >>> 0);
  const { w: W, h: H } = frame(n, r);
  const k = Math.sqrt((W * H) / n);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);

  // Rejection sampling in a square rather than R*cos(theta): Math.cos is not
  // required to be correctly rounded, so a trig-free start keeps the initial
  // placement bit-identical across engines. Arithmetic and sqrt are specified.
  const R = Math.min(W, H) * 0.45;
  for (let i = 0; i < n; i++) {
    let px = 0, py = 0;
    do { px = (rand() * 2 - 1) * R; py = (rand() * 2 - 1) * R; }
    while (px * px + py * py > R * R);
    x[i] = px; y[i] = py;
  }

  const idx = new Map(g.nodes.map((id, i) => [id, i]));
  /** @type {Array<[number, number]>} */
  const links = [];
  for (const e of g.edges) {
    if (e.loop) continue;
    const a = idx.get(e.u), b = idx.get(e.v);
    if (a !== undefined && b !== undefined) links.push([a, b]);
  }

  const t0 = W / 10;
  for (let iter = 0; iter < FORCE_ITERS; iter++) {
    const t = t0 * (1 - iter / FORCE_ITERS); // linear cooling to zero
    dx.fill(0); dy.fill(0);

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ex = x[i] - x[j], ey = y[i] - y[j];
        let d = Math.sqrt(ex * ex + ey * ey);
        if (d < 0.01) {
          // Two nodes exactly on top of each other have no direction to push
          // apart along. The nudge comes from the seeded PRNG so the picture
          // stays reproducible even in the degenerate case.
          ex = rand() - 0.5; ey = rand() - 0.5;
          d = Math.sqrt(ex * ex + ey * ey) || 1;
        }
        const f = (k * k) / d;
        dx[i] += (ex / d) * f; dy[i] += (ey / d) * f;
        dx[j] -= (ex / d) * f; dy[j] -= (ey / d) * f;
      }
    }

    for (const [a, b] of links) {
      const ex = x[a] - x[b], ey = y[a] - y[b];
      const d = Math.sqrt(ex * ex + ey * ey) || 0.01;
      const f = (d * d) / k;
      dx[a] -= (ex / d) * f; dy[a] -= (ey / d) * f;
      dx[b] += (ex / d) * f; dy[b] += (ey / d) * f;
    }

    for (let i = 0; i < n; i++) {
      const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
      if (d < 1e-9) continue;
      const step = Math.min(d, t);
      x[i] += (dx[i] / d) * step;
      y[i] += (dy[i] / d) * step;
      // Fruchterman-Reingold's own frame clamp, and it is not cosmetic: the
      // repulsion term happily pushes nodes far outside the frame whose area
      // set k in the first place, and the bounding box then grows without any
      // more nodes being drawn.
      x[i] = Math.min(W / 2, Math.max(-W / 2, x[i]));
      y[i] = Math.min(H / 2, Math.max(-H / 2, y[i]));
    }
  }

  const pos = new Map();
  g.nodes.forEach((id, i) => pos.set(id, { x: x[i], y: y[i] }));
  return pos;
}

/**
 * mulberry32. Thirty-two bits of state, one multiply and three shifts per draw,
 * and it passes gjrand -- far more than enough to scatter forty points.
 *
 * The point is not statistical quality, it is that the sequence is OURS. With
 * Math.random the same share link draws a different graph on every open, and
 * BACKEND.md 2.3 promises it will not.
 */
export function mulberry32(a) {
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// post-passes
// ---------------------------------------------------------------------------

/**
 * Pack component bounding boxes left to right.
 *
 * A force layout pushes disconnected components apart with nothing pulling them
 * back, so on a graph with three components two end up far off screen and the
 * fit-to-bounds camera shrinks the third to nothing. Packing bounds the damage
 * to a wider picture. RENDERERS/GRAPH.md 8.
 */
function packComponents(g, pos) {
  const comps = components(g);
  if (comps.length < 2) return;
  let cursor = 0;
  for (const comp of comps) {
    const b = bounds(comp.map((id) => pos.get(id)));
    const midY = (b.minY + b.maxY) / 2;
    for (const id of comp) {
      const p = pos.get(id);
      if (!p) continue;
      p.x += cursor - b.minX;
      p.y -= midY;
    }
    cursor += (b.maxX - b.minX) + COMPONENT_GAP;
  }
}

/**
 * Rotate so the highest-degree node sits left of centre.
 *
 * Without this the same graph is drawn at an arbitrary rotation for every seed,
 * and switching between two algorithms over the same graph looks like the graph
 * changed. Deterministic, and it puts the busiest node where a left-to-right
 * reader starts.
 */
function rotateHighestDegreeLeft(g, pos) {
  if (g.nodes.length < 3) return;
  let hub = g.nodes[0];
  for (const id of g.nodes) {
    if ((g.deg.get(id) ?? 0) > (g.deg.get(hub) ?? 0)) hub = id; // ties: first declared
  }
  const cx = mean(g.nodes.map((id) => pos.get(id)?.x ?? 0));
  const cy = mean(g.nodes.map((id) => pos.get(id)?.y ?? 0));
  const h = pos.get(hub);
  if (!h) return;
  const ex = h.x - cx, ey = h.y - cy;
  if (Math.sqrt(ex * ex + ey * ey) < 1e-6) return;
  const theta = Math.PI - Math.atan2(ey, ex);
  const c = Math.cos(theta), s = Math.sin(theta);
  for (const id of g.nodes) {
    const p = pos.get(id);
    if (!p) continue;
    const px = p.x - cx, py = p.y - cy;
    p.x = cx + px * c - py * s;
    p.y = cy + px * s + py * c;
  }
}

/** The force frame: enough room for one cell per node, in landscape. */
function frame(n, r) {
  const area = n * (2 * r + FORCE_GAP) ** 2;
  return { w: Math.sqrt(area * FORCE_ASPECT), h: Math.sqrt(area / FORCE_ASPECT) };
}

/** Scale uniformly about the centroid until the bounding box fits. Uniform,
 *  because anything else would stretch the picture and change what the reader
 *  infers from a long edge. */
function fitInto(pos, box) {
  const b = bounds([...pos.values()]);
  const w = b.maxX - b.minX, h = b.maxY - b.minY;
  const k = Math.min(w > 0 ? box.w / w : 1, h > 0 ? box.h / h : 1);
  if (k >= 1) return;
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  for (const p of pos.values()) {
    p.x = cx + (p.x - cx) * k;
    p.y = cy + (p.y - cy) * k;
  }
}

/** Translate to the origin with a padding margin, and report the extent. */
function normalize(pos, pad) {
  const b = bounds([...pos.values()]);
  for (const p of pos.values()) {
    p.x = p.x - b.minX + pad;
    p.y = p.y - b.minY + pad;
  }
  return {
    pos,
    w: Math.max(b.maxX - b.minX + pad * 2, pad * 4),
    h: Math.max(b.maxY - b.minY + pad * 2, pad * 4),
  };
}

function bounds(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (!p) continue;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
