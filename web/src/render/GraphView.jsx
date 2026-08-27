// @ts-check
import { memo, useMemo } from 'react';
import { addrKey, fmtValue, refID } from '../lib/value.js';
import { buildGraph, neighbourhood, edgeKey, orientEdge } from './layout/graphShape.js';
import { graphLayout, MAX_NODES } from './layout/graphLayout.js';
import { useReadSet } from './Linear.jsx';
import { resolveFocus } from './focus.js';

/**
 * Dijkstra, BFS, DFS, MST, topological sort.
 *
 * THE PROBLEM THIS RENDERER SOLVES is clutter. A Dijkstra frame wants to show
 * every node's distance, every node's set membership, every edge's weight, the
 * edge being relaxed and the arithmetic behind it, and the shortest-path tree
 * so far. Drawn at full strength on twenty nodes that is five overlapping
 * channels and it cannot be read.
 *
 * The answer is focus plus context: exactly ONE neighbourhood is at full
 * strength -- the cursor node and what it points at, which is exactly what the
 * algorithm is touching -- and everything else drops to shape without data.
 * RENDERERS/GRAPH.md 2.
 *
 * Everything per-algorithm arrives through `spec.options`. There is no branch
 * on the algorithm anywhere in this file, and if one ever looks necessary the
 * fix is another option key, not an `if` (I2).
 */
export default function GraphView({ store, spec, version, focus, onFocus, onPin }) {
  const s = store.struct(spec.s);
  const union = store.index.structUnion.get(spec.s);
  const opts = spec.options ?? {};

  const g = useMemo(() => buildGraph(union), [union]);
  const seed = opts.seed ?? store.trace?.meta?.seed ?? 0x9e3779b9;
  // Keyed on the union, which never changes during a run, so the layout is
  // computed exactly once no matter how far the scrubber is dragged.
  const layout = useMemo(() => graphLayout(g, seed), [g, seed]);

  const refs = s ? s.refs() : {};
  const cursor = refs[opts.cursorRef ?? 'u'] ?? null;
  const active = useMemo(() => neighbourhood(g, cursor), [g, cursor]);

  const changed = store.changed();
  const reads = useReadSet(store);
  const lit = resolveFocus(store, focus);
  const queued = useQueueSet(store, opts, version);
  const treeEdges = useTreeEdges(store, g, opts, version);
  const pathEdges = usePathEdges(store, g, opts, version);
  const ringed = queueHover(store, focus, opts);
  const pill = relaxation(store, spec, opts, cursor);
  // The node being examined is the one the step's own arithmetic is about, so
  // it comes from the same place the pill does rather than from a second
  // lookup that could disagree with it.
  const probe = pill?.v ?? null;
  const scale = useLayerScale(store, opts, g, version);

  // Every hook above runs unconditionally: React counts hooks by call order, so
  // an early return placed among them changes the count between renders.
  if (!s) return <div className="pane-note">not created yet</div>;
  if (g.nodes.length === 0) return <div className="pane-note">empty graph</div>;
  if (g.nodes.length > MAX_NODES) {
    return (
      <div className="pane-note">
        {g.nodes.length} nodes is past what this view can draw legibly (the limit
        is {MAX_NODES}). A graph that size is not a teaching picture; refusing it
        is better than drawing it badly.
      </div>
    );
  }

  const dist = (id) => (opts.distOf ? store.struct(opts.distOf)?.get([id]) : undefined);
  const edgeW = (e) => {
    const v = s.get(['$edges', e.key, opts.edgeWeight ?? 'w']);
    return v === null || v === undefined ? e.w : v;
  };
  const edgeState = (e) =>
    (opts.edgeStateOf ? s.get(['$edges', e.key, opts.edgeStateOf]) : null) ?? '';

  const wide = layout.w > SCROLL_ABOVE;
  const order = drawOrder(g, active, treeEdges, pathEdges, opts.edgeOrder, edgeW);
  // An algorithm that declares no cursor stands nowhere -- Kruskal walks a
  // sorted edge list rather than a neighbourhood. Focus and context need a
  // centre, so with none there is nothing to dim and every weight is on.
  const focused = cursor !== null;
  // An edge attribute written this step flashes, the same amber every other
  // write in the app uses. Generic, so `st` and `w` both get it for free.
  const hotEdges = edgeFlash(changed, spec.s);

  return (
    <svg className="graph" role="img" data-big={layout.r === 14 ? 1 : 0}
         viewBox={`0 0 ${layout.w} ${layout.h}`}
         preserveAspectRatio="xMidYMid meet"
         style={wide ? { width: layout.w, height: layout.h, flex: 'none' } : undefined}>
      <title>{`${g.nodes.length} nodes, ${g.edges.length} edges, ${layout.strategy} layout`}</title>
      <defs>
        <marker id="gv-arrow" viewBox="0 0 8 8" refX="7" refY="4"
                markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 8 4 L 0 8 z" />
        </marker>
      </defs>

      {order.map((i) => {
        const e = g.edges[i];
        const a = layout.pos.get(e.u), b = layout.pos.get(e.v);
        if (!a || !b) return null;
        // Unordered for an undirected graph: the pill runs cursor-to-probe, but
        // the edge was declared in whatever order the producer wrote it, and
        // matching on direction alone left half of them unstyled.
        const relaxing = !!pill &&
          ((pill.u === e.u && pill.v === e.v) ||
           (!g.directed && pill.u === e.v && pill.v === e.u));
        return (
          <GEdge key={`${e.key}#${i}`} e={e} a={a} b={b} r={layout.r}
                 directed={g.directed}
                 w={g.weighted ? fmtValue(edgeW(e)) : ''}
                 state={String(edgeState(e))}
                 tree={treeEdges.has(i)}
                 path={pathEdges.has(i)}
                 on={!focused || active.edges.has(i)}
                 hot={hotEdges.has(e.key)}
                 relaxing={relaxing}
                 fail={relaxing && !pill.ok} />
        );
      })}

      {g.nodes.map((id) => {
        const key = addrKey(opts.distOf ?? spec.s, [id]);
        const d = dist(id);
        return (
          <GNode key={id} id={id} r={layout.r} p={layout.pos.get(id)}
                 anchor={key}
                 d={opts.distOf ? fmtValue(d) : ''}
                 member={membership(store, opts, queued, id)}
                 layerT={scale ? scale(d) : -1}
                 cursor={id === cursor}
                 probe={id === probe}
                 flash={changed.has(key)}
                 read={reads.has(key)}
                 linked={lit.cells.has(key) || ringed === id}
                 dim={focused && !active.nodes.has(id)}
                 chips={chipsFor(refs, id, opts)}
                 onFocus={onFocus} onPin={onPin}
                 s={opts.distOf ?? spec.s} />
        );
      })}

      {pill && <Pill pill={pill} layout={layout} />}
    </svg>
  );
}

/** Past this the picture stops scaling down and the pane scrolls instead --
 *  same arithmetic as the tree: a squeezed 12px label renders at 6px, which
 *  fits and cannot be read. */
const SCROLL_ABOVE = 860;

// ---------------------------------------------------------------------------
// nodes
// ---------------------------------------------------------------------------

/**
 * Four channels, each carrying one fact and none redundant with another: fill
 * is set membership, the ring is the cursor, the flash is "changed this step",
 * the sub-label is the distance. RENDERERS/GRAPH.md 3.
 *
 * The dot under the node is deliberate redundancy and the one exception:
 * filled means settled, hollow means queued, absent means unseen. Fill alone is
 * a hue difference, and UI_DESIGN.md 2.4 will not let a hue be the only carrier
 * of a fact.
 */
const GNode = memo(function GNode({
  id, p, r, d, member, layerT, cursor, probe, flash, read, linked, dim, chips,
  anchor, s, onFocus, onPin,
}) {
  if (!p) return null;
  const at = [id];
  return (
    <g className="gnode enter"
       transform={`translate(${p.x} ${p.y})`}
       data-member={member} data-cursor={cursor ? 1 : 0} data-probe={probe ? 1 : 0}
       data-w={flash ? 1 : 0} data-r={read ? 1 : 0}
       data-linked={linked ? 1 : 0} data-dim={dim ? 1 : 0}
       data-layer={layerT >= 0 ? 1 : 0}
       style={layerT >= 0 ? { '--layer': layerT } : undefined}
       data-anchor={anchor}
       tabIndex={0}
       aria-label={`node ${id}${d ? `, ${d}` : ''}, ${member}`}
       onMouseEnter={() => onFocus?.({ kind: 'cell', s, at })}
       onMouseLeave={(e) => {
         // A mouse-leave must not clobber a KEYBOARD focus; the same defect the
         // Linear cells hit, and the same guard.
         if (document.activeElement !== e.currentTarget) onFocus?.(null);
       }}
       onFocus={() => onFocus?.({ kind: 'cell', s, at })}
       onBlur={() => onFocus?.(null)}
       onClick={() => onPin?.({ kind: 'cell', s, at })}>
      <circle className="disc" r={r} />
      <text className="lbl" y={4}>{id}</text>
      {member !== 'unseen' &&
        <circle className="dot" cy={r - 4} r={2.5} data-fill={member === 'settled' ? 1 : 0} />}
      {d !== '' && <text className="dist" y={r + 14}>{d}</text>}
      {chips !== '' && <text className="refchip" y={-r - 7}>{chips}</text>}
    </g>
  );
}, (a, b) =>
  a.d === b.d && a.member === b.member && a.cursor === b.cursor && a.probe === b.probe &&
  a.flash === b.flash && a.read === b.read && a.linked === b.linked && a.dim === b.dim &&
  a.chips === b.chips && a.layerT === b.layerT && a.p === b.p && a.r === b.r);

// ---------------------------------------------------------------------------
// edges
// ---------------------------------------------------------------------------

const GEdge = memo(function GEdge({
  e, a, b, r, directed, w, state, tree, path, on, hot, relaxing, fail,
}) {
  const geom = e.loop ? loopPath(a, r) : straight(a, b, r, e.lane, directed);
  return (
    <g className="gedge"
       data-on={on ? 1 : 0} data-tree={tree ? 1 : 0} data-path={path ? 1 : 0}
       data-w={hot ? 1 : 0}
       data-state={state} data-relax={relaxing ? (fail ? 'fail' : 'ok') : ''}>
      <path className="wire" d={geom.d}
            markerEnd={directed ? 'url(#gv-arrow)' : undefined} />
      {/* The weight is hidden outside the active neighbourhood: on 40 edges it
          is the single largest source of clutter, and the number is only
          actionable for the edges being considered right now. */}
      {w !== '' && (on || tree || hot || relaxing) &&
        <text className="wt" x={geom.mid.x} y={geom.mid.y - 4}
              transform={`rotate(${geom.deg} ${geom.mid.x} ${geom.mid.y})`}>{w}</text>}
    </g>
  );
});

/**
 * Edge keys whose attributes were written by the last transition.
 *
 * Read out of the `changed` set rather than out of the events, so it survives a
 * scrub: seeking accumulates every address touched along the way, and an edge
 * the drag passed through should flash on arrival like everything else.
 */
function edgeFlash(changed, name) {
  const out = new Set();
  const prefix = name + ' $edges/';
  for (const key of changed) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    const slash = rest.indexOf('/');
    out.add(slash < 0 ? rest : rest.slice(0, slash));
  }
  return out;
}

/**
 * A straight edge, shortened at both ends so it meets the circle rather than
 * the centre, and offset perpendicular by its lane so parallel edges separate.
 */
function straight(a, b, r, lane, directed) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len, uy = dy / len;
  const off = lane * 8;
  const ox = -uy * off, oy = ux * off;
  const gap = r + (directed ? 5 : 2);
  const p1 = { x: a.x + ux * gap + ox, y: a.y + uy * gap + oy };
  const p2 = { x: b.x - ux * gap + ox, y: b.y - uy * gap + oy };
  return {
    d: `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`,
    mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
    deg: upright(Math.atan2(dy, dx)),
  };
}

/** A self-loop is a circular arc above the node -- there is nowhere else for it
 *  to go, and drawing nothing would hide a real edge. */
function loopPath(a, r) {
  const k = r * 1.5;
  return {
    d: `M ${a.x - r * 0.6} ${a.y - r * 0.8} C ${a.x - k} ${a.y - k * 2.2}, ` +
       `${a.x + k} ${a.y - k * 2.2}, ${a.x + r * 0.6} ${a.y - r * 0.8}`,
    mid: { x: a.x, y: a.y - r - k },
    deg: 0,
  };
}

const clamp = (deg, lim) => Math.max(-lim, Math.min(lim, deg));

/** Rotate a label to its edge, then flip it if that would leave it upside
 *  down. A weight the reader has to tilt their head for is not a label. */
function upright(rad) {
  let deg = (rad * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  if (deg < -90) deg += 180;
  return deg;
}

/**
 * Draw order, back to front: context, then the shortest-path tree, then the
 * active neighbourhood, then whatever is being relaxed.
 *
 * SVG has no z-index, so paint order IS stacking order. Without this an
 * important edge is covered by an irrelevant one purely because of where it sat
 * in the declaration.
 */
function drawOrder(g, active, tree, path, edgeOrder, weightOf) {
  const rank = (i) =>
    (active.edges.has(i) ? 3 : 0) + (path.has(i) ? 2 : 0) + (tree.has(i) ? 1 : 0);
  const idx = g.edges.map((_, i) => i);
  return idx.sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    // `edgeOrder: "weight"` puts the light edges on top, which is the order a
    // Kruskal viewer reads them in. Declaration order otherwise.
    if (edgeOrder === 'weight') {
      const wa = Number(weightOf(g.edges[a])), wb = Number(weightOf(g.edges[b]));
      if (Number.isFinite(wa) && Number.isFinite(wb) && wa !== wb) return wb - wa;
    }
    return a - b;
  });
}

// ---------------------------------------------------------------------------
// the relaxation pill
// ---------------------------------------------------------------------------

/**
 * The arithmetic, on the edge.
 *
 * THE SINGLE HIGHEST-VALUE DETAIL IN THIS RENDERER. Instead of the explanation
 * pane saying "0 + 2 = 2, which beats infinity" somewhere else on the screen,
 * the edge itself says it, next to the two numbers it is about.
 *
 * The text is `expr` on a successful write and, for the candidate that wrote
 * nothing at all, whatever the probe cursor carried -- both produced by the
 * algorithm, neither generated here. A failed relaxation writes nothing to
 * dist, so it is a step only at detail level 1, and it is the clearest
 * demonstration in the project that cursor structures are a real mechanism
 * rather than a workaround.
 * RENDERERS/GRAPH.md 4.
 */
function relaxation(store, spec, opts, cursor) {
  if (!cursor) return null;
  const evs = store.currentEvents();

  for (const e of evs) {
    if (e.t !== 'set' || !opts.distOf || e.s !== opts.distOf) continue;
    const v = String((e.at ?? [])[0] ?? '');
    if (!v || v === cursor || !e.expr) continue;
    return { u: cursor, v, text: e.expr, ok: true };
  }

  // The probe's ARRIVAL, which is the last of its writes in the step: moving a
  // cursor is a park followed by an arrival, so the first write is a departure
  // to nowhere. Text comes from the step as a whole, the same way explain.js
  // reads a group -- attaching it to one event of a group and reading it from
  // another is how these two would drift apart.
  let v = null;
  for (const e of evs) {
    if (e.t !== 'set') continue;
    v = probeTarget(e, spec, opts) ?? v;
  }
  if (v) {
    // `expr` means the candidate was accepted and the write follows; a bare
    // `note` means it was rejected. That is the same expr/note split the format
    // uses everywhere else, not a convention invented for graphs -- so the tick
    // and the cross are read out of the trace rather than guessed at.
    const withExpr = evs.find((e) => e.expr);
    const text = withExpr?.expr ?? evs.find((e) => e.note)?.note;
    if (text) return { u: cursor, v, text, ok: !!withExpr };
  }
  return null;
}

/**
 * The node a probe event is about, whichever shape the producer chose.
 *
 * Three, because the constraint that picks between them is not a matter of
 * taste. A `$refs` pointer on the graph is what TRACE_FORMAT.md 12.7 shows and
 * it reads best, but check V8 permits `lvl` only on structures declared aux --
 * and a graph carrying the main view cannot be aux. So an algorithm that wants
 * its examinations filterable by detail level reaches for an aux structure
 * instead: a map keyed by the node, or a scalar naming it.
 */
function probeTarget(e, spec, opts) {
  const at = e.at ?? [];
  if (opts.probeOf) {
    if (e.s !== opts.probeOf) return null;
    return at.length > 0 ? String(at[0]) : entryNode(e.to);
  }
  if (e.s !== spec.s || at[0] !== '$refs' || at[1] !== (opts.probeRef ?? 'v')) return null;
  return refID(e.to);
}

function Pill({ pill, layout }) {
  const a = layout.pos.get(pill.u), b = layout.pos.get(pill.v);
  if (!a || !b) return null;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // Follow the edge, but only so far. "Upright" is not enough for a string this
  // long: a nearly vertical edge measured 86 degrees, and a 39-character pill
  // at 86 degrees runs 240 units down a picture 300 units tall. A single-digit
  // weight can take any angle; a sentence cannot.
  const deg = clamp(upright(Math.atan2(b.y - a.y, b.x - a.x)), 25);
  const text = `${pill.text} ${pill.ok ? '✓' : '✗'}`;
  // Character-width estimate rather than getBBox: measuring means reading
  // layout back out of the DOM during render, and the pill is a monospace
  // string, so 6.2px per character is accurate to a pixel or two.
  const w = text.length * 6.2 + 14;
  return (
    <g className="relax-pill" data-ok={pill.ok ? 1 : 0}
       transform={`translate(${mid.x} ${mid.y - 16}) rotate(${deg})`}>
      <rect x={-w / 2} y={-10} width={w} height={20} rx={10} />
      <text y={4}>{text}</text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// state -> presentation, all of it option-driven
// ---------------------------------------------------------------------------

function membership(store, opts, queued, id) {
  if (opts.settledOf && truthy(store.struct(opts.settledOf)?.get([id]))) return 'settled';
  if (queued.has(id)) return 'queued';
  return 'unseen';
}

const truthy = (v) => v === true || (typeof v === 'number' && v !== 0) || v === 'true';

/**
 * Who is in the frontier: whoever is in the array `options.queueOf` names.
 *
 * DECLARED, never inferred. The first version fell back to "has a finite
 * distance and is not settled yet", which is true for Dijkstra and BFS and
 * quietly wrong for everything else -- Kruskal writes a component label to
 * every node before its first decision, so every node came out violet, and
 * violet means frontier. An algorithm with no frontier declares no queue and
 * gets none.
 */
function useQueueSet(store, opts, version) {
  return useMemo(() => {
    const out = new Set();
    const q = opts.queueOf ? store.struct(opts.queueOf) : null;
    const n = q?.dims?.[0] ?? 0;
    for (let i = 0; i < n; i++) {
      const id = entryNode(q.get([i]));
      if (id) out.add(id);
    }
    return out;
  }, [store, opts.queueOf, version]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * A queue entry to a node id.
 *
 * THE ONE GRAPH-AWARE LINE the design allows, and it lives here rather than in
 * Linear, which is allowed to know nothing. An entry is either a ref into the
 * graph or a "node:key" string -- the second because a priority queue reads far
 * better in its own pane as `c:2` than as a bare id. RENDERERS/GRAPH.md 5.
 */
function entryNode(v) {
  const r = refID(v);
  if (r) return r;
  if (typeof v === 'string' && v !== '') return v.split(':')[0];
  return null;
}

/** Hovering a priority-queue cell rings the node it stands for. */
function queueHover(store, focus, opts) {
  if (!focus || focus.kind !== 'cell' || !opts.queueOf || focus.s !== opts.queueOf) return null;
  const q = store.struct(opts.queueOf);
  return q ? entryNode(q.get(focus.at ?? [])) : null;
}

/**
 * The shortest-path tree, from a predecessor map.
 *
 * Never dimmed and never rebuilt: it accumulates as the run proceeds and stays
 * visible in context, which is what makes "the answer" a thing you watch being
 * assembled rather than a thing announced at the end.
 */
function useTreeEdges(store, g, opts, version) {
  return useMemo(() => {
    const out = new Set();
    if (!opts.predOf) return out;
    const pred = store.struct(opts.predOf);
    if (!pred) return out;
    /** @type {Map<string, number[]>} */
    const byKey = new Map();
    g.edges.forEach((e, i) => {
      const arr = byKey.get(e.key);
      if (arr) arr.push(i); else byKey.set(e.key, [i]);
    });
    for (const v of g.nodes) {
      const u = entryNode(pred.get([v]));
      if (!u || u === v) continue;
      const [a, b] = orientEdge(u, v, g.directed);
      for (const i of byKey.get(edgeKey(a, b)) ?? []) out.add(i);
    }
    return out;
  }, [store, g, opts.predOf, version]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * The current path, for DFS: `options.pathRef` names the stack array, and
 * consecutive entries are the chain. Reading it from the stack rather than
 * inferring it means the picture is exactly what the algorithm holds.
 */
function usePathEdges(store, g, opts, version) {
  return useMemo(() => {
    const out = new Set();
    if (!opts.pathRef) return out;
    const st = store.struct(opts.pathRef);
    const n = st?.dims?.[0] ?? 0;
    /** @type {Map<string, number[]>} */
    const byKey = new Map();
    g.edges.forEach((e, i) => {
      const arr = byKey.get(e.key);
      if (arr) arr.push(i); else byKey.set(e.key, [i]);
    });
    let prev = null;
    for (let i = 0; i < n; i++) {
      const id = entryNode(st.get([i]));
      if (id && prev) {
        const [a, b] = orientEdge(prev, id, g.directed);
        for (const j of byKey.get(edgeKey(a, b)) ?? []) out.add(j);
      }
      if (id) prev = id;
    }
    return out;
  }, [store, g, opts.pathRef, version]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * `options.distAs: "layer"` tints by distance instead of by set membership,
 * which is what turns BFS from "a frontier moving" into "the layers of the
 * graph". Normalised against the widest distance the run will EVER reach, taken
 * from the union, so the scale does not rescale itself every step.
 */
function useLayerScale(store, opts, g, version) {
  return useMemo(() => {
    if (opts.distAs !== 'layer' || !opts.distOf) return null;
    const d = store.struct(opts.distOf);
    if (!d) return null;
    let max = 0;
    for (const id of g.nodes) {
      const v = d.get([id]);
      if (typeof v === 'number' && v > max) max = v;
    }
    const span = Math.max(1, max);
    return (v) => (typeof v === 'number' ? Math.min(1, v / span) : -1);
  }, [store, opts.distAs, opts.distOf, g, version]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Named pointers ride ON the node they point at, exactly as in the tree, so a
 *  reader who learned one renderer can read this one. */
function chipsFor(refs, id, opts) {
  const names = [];
  for (const [name, target] of Object.entries(refs ?? {})) {
    if (target === id && name !== (opts.hideRef ?? '')) names.push(name);
  }
  return names.join(' ');
}
