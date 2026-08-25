// @ts-check
import { memo, useMemo, useRef } from 'react';
import { addrKey, fmtValue } from '../lib/value.js';
import { tidyTree } from './layout/tidyTree.js';
import { buildShape, currentEdges, finalEdges, layoutCovers } from './layout/treeShape.js';
import { useReadSet } from './Linear.jsx';
import { resolveFocus } from './focus.js';

const NODE_R = 20;
const LEVEL_H = 64;
const SIB_GAP = 16;
const MAX_SVG_NODES = 1200;
// Wider than this and the pane scrolls instead of shrinking the picture; see
// useCamera for the arithmetic that picked it.
const SCROLL_ABOVE = 820;

/**
 * BSTs, tries, any `kind: nodes` structure whose schema declares two pointer
 * fields in `order`.
 *
 * It shares layout/tidyTree.js with the recursion tree, completely unchanged.
 * That reuse is the architectural claim being cashed in: the two families look
 * nothing alike and disagree about almost everything else, but "arrange a tree
 * so parents centre over children and nothing overlaps" is one problem, solved
 * once. It is why this renderer cost about a day. RENDERERS/TREE.md.
 *
 * The renderer never learns which algorithm produced the trace. It reads node
 * ids, pointer fields named by the schema, and named refs — data, not code (I2).
 */
export default function TreeView({ store, spec, version, focus, onFocus }) {
  const s = store.struct(spec.s);
  const union = store.index.structUnion.get(spec.s);
  const boxRef = useRef(/** @type {SVGSVGElement|null} */(null));

  const schema = s?.schema ?? union?.schema ?? null;
  const fields = useMemo(() => ptrFields(schema), [schema]);
  const labelField = schema?.label ?? 'val';

  const now = useMemo(
    () => currentEdges(s, fields),
    // store.version, not `s`: the Struct is MUTATED in place, so its identity
    // never changes and a dependency on it alone would never re-run.
    [s, fields, version], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const { layout, shape } = useTreeLayout(union, now, fields, labelField, store, spec.s);

  const changed = store.changed();
  const reads = useReadSet(store);
  const lit = resolveFocus(store, focus);
  const refs = s ? s.refs() : {};
  const refAt = useMemo(() => invertRefs(refs), [JSON.stringify(refs)]);

  const view = useCamera(layout, shape, s);

  // Every hook above runs unconditionally: React counts hooks by call order, so
  // an early return placed among them changes the count between renders.
  if (!s) return <div className="pane-note">not created yet</div>;
  if (shape.ids.length === 0) return <div className="pane-note">empty tree</div>;
  if (countLive(shape, s) === 0) return <div className="pane-note">empty tree</div>;

  const tooBig = shape.ordOf.size > MAX_SVG_NODES;

  return (
    <svg className="tree" ref={boxRef} viewBox={view.viewBox}
         preserveAspectRatio="xMidYMid meet"
         style={view.scroll ? { width: view.w, height: view.h, flex: 'none' } : undefined}>
      <g>
        {/* Empty slots first, under everything. They are the reason a node with
            one child visibly leans, and turning "there is no right child" into
            a mark you can point at rather than a gap you have to notice is
            worth the pixels while watching a descent. */}
        {shape.ids.map((id, ord) => {
          if (id || shape.parent[ord] < 0) return null;
          // A slot already occupied by a dangling stub is not empty; drawing a
          // "nothing here" dot under the "points at something missing" marker
          // would contradict it.
          if (shape.danglingSlots.has(ord)) return null;
          const par = shape.ids[shape.parent[ord]];
          if (!par || !s.exists(par)) return null;
          return <circle key={`s${ord}`} className="slot"
                         cx={layout.x[ord]} cy={layout.y[ord]} r={4} />;
        })}

        {shape.ids.map((id, ord) => {
          const par = shape.parent[ord];
          if (!id || par < 0) return null;
          const pid = shape.ids[par];
          // An edge exists only while the pointer that makes it exists. Undo
          // the write and it is gone, with nothing else to keep in step.
          if (!pid || !s.exists(pid) || !s.exists(id)) return null;
          if (!edgeLive(now, pid, id, fields)) return null;
          return <Edge key={`e${ord}`} a={pt(layout, par)} b={pt(layout, ord)}
                       label={edgeLabel(s, id, spec.options?.edgeLabel)} />;
        })}

        {/* A second parent is a BUG in the algorithm, so both edges are drawn
            and neither is deduped. Showing it is the feature. */}
        {shape.extra.map((e, i) => {
          const from = shape.ids[e.from], to = shape.ids[e.to];
          if (!s.exists(from) || !s.exists(to)) return null;
          if (now.get(`${from}|${e.field}`) !== to) return null;
          return <Edge key={`x${i}`} a={pt(layout, e.from)} b={pt(layout, e.to)} bad />;
        })}

        {shape.back.map((e, i) => {
          const from = shape.ids[e.from], to = shape.ids[e.to];
          if (!s.exists(from) || !s.exists(to)) return null;
          if (now.get(`${from}|${e.field}`) !== to) return null;
          return <path key={`b${i}`} className="edge back"
                       d={arc(pt(layout, e.from), pt(layout, e.to))} />;
        })}

        {/* A pointer into a node that is not there any more gets a stub and a
            question mark rather than nothing, because "this ref is dangling" is
            information and an absent edge is not. */}
        {shape.dangling.map((d, i) => {
          const from = shape.ids[d.from];
          if (!s.exists(from) || now.get(`${from}|${d.field}`) !== d.target) return null;
          const a = pt(layout, d.from);
          const b = pt(layout, d.slot);
          return (
            <g key={`d${i}`}>
              <Edge a={a} b={b} bad />
              <circle className="stub" cx={b.x} cy={b.y} r={7} />
              <text className="stub-t" x={b.x} y={b.y + 3}>?</text>
            </g>
          );
        })}

        {shape.ids.map((id, ord) => {
          if (!id || !s.exists(id)) return null;
          const key = addrKey(spec.s, [id]);
          const vkey = addrKey(spec.s, [id, labelField]);
          return (
            <TNode key={id} id={id} s={spec.s}
                   x={layout.x[ord]} y={layout.y[ord]}
                   v={fmtValue(s.get([id, labelField]))}
                   w={changed.has(key) || changed.has(vkey)}
                   rd={reads.has(vkey) || reads.has(key)}
                   ring={refAt.get(id) ?? ''}
                   bad={shape.multiParent.has(id)}
                   linked={lit.cells.has(key) || lit.cells.has(vkey)}
                   onFocus={onFocus} />
          );
        })}

        {/* Named pointers ride ON the node they point at rather than floating in
            a legend, because "where is `cur`" is the question being asked. */}
        {Object.entries(refs).map(([name, id]) => {
          const ord = id ? shape.ordOf.get(id) : undefined;
          if (ord === undefined || !s.exists(id)) return null;
          return (
            <text key={name} className="refchip"
                  x={layout.x[ord]} y={layout.y[ord] - NODE_R - 7}>{name}</text>
          );
        })}
      </g>
      {(shape.back.length > 0 || shape.multiParent.size > 0 || tooBig) && (
        <Badges back={shape.back.length} multi={shape.multiParent.size} tooBig={tooBig} />
      )}
    </svg>
  );
}

/**
 * Layout, and the one rule that keeps it from moving.
 *
 * The layout is built from the union's FINAL shape, so a node that appears at
 * step 40 already has its coordinates at step 0 and simply is not drawn yet.
 * While the current edges remain a SUBSET of that shape — which is the case for
 * anything that only grows — the same layout is reused and nothing shifts.
 *
 * A rotation is not a subset: it aims a pointer somewhere the final shape does
 * not. Then, and only then, the layout is recomputed and memoised per shape, so
 * distinct shapes each cost once and cycling back to an earlier one is free.
 * There the movement is right — a rotation IS movement. RENDERERS/TREE.md 3.1.
 */
function useTreeLayout(union, now, fields, labelField, store, name) {
  const cache = useRef(/** @type {Map<string, any>} */(new Map()));

  const base = useMemo(() => {
    cache.current = new Map();
    const ids = union?.nodeIds ?? [];
    const edges = finalEdges(union, fields);
    return { ids, edges, ...computed(ids, edges, fields, union) };
  }, [union, fields]);

  if (layoutCovers(now, base.edges)) return base;

  const hash = [...now].sort().map(([k, v]) => `${k}>${v}`).join(',');
  let hit = cache.current.get(hash);
  if (!hit) {
    hit = computed(base.ids, now, fields, union);
    // Bounded so a long run of rotations cannot grow this without limit; the
    // whole point of the cache is the cheap case of cycling between shapes.
    if (cache.current.size > 64) cache.current.clear();
    cache.current.set(hash, hit);
  }
  return hit;
}

function computed(ids, edges, fields, union) {
  const shape = buildShape(ids, edges, union?.schema?.order);
  const w = Math.max(NODE_R * 2, 14 + (union?.maxValueWidth ?? 1) * 9);
  const layout = tidyTree(
    { kids: shape.kids, roots: shape.roots, depth: [] },
    w, NODE_R * 2, SIB_GAP, LEVEL_H - NODE_R * 2,
  );
  return { layout, shape };
}

const TNode = memo(function TNode({ id, s, x, y, v, w, rd, ring, bad, linked, onFocus }) {
  return (
    <g className="tnode enter" data-w={w ? 1 : 0} data-r={rd ? 1 : 0}
       data-ring={ring} data-bad={bad ? 1 : 0} data-linked={linked ? 1 : 0}
       data-anchor={addrKey(s, [id])}
       transform={`translate(${x} ${y})`}
       onMouseEnter={() => onFocus?.({ kind: 'cell', s, at: [id] })}
       onMouseLeave={() => onFocus?.(null)}>
      <circle r={NODE_R} />
      <text y={4}>{v}</text>
    </g>
  );
}, (a, b) => a.v === b.v && a.w === b.w && a.rd === b.rd && a.ring === b.ring &&
             a.bad === b.bad && a.linked === b.linked && a.x === b.x && a.y === b.y);

function Edge({ a, b, bad, label }) {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return (
    <>
      <line className="edge" data-bad={bad ? 1 : 0}
            x1={a.x} y1={a.y + NODE_R} x2={b.x} y2={b.y - NODE_R} />
      {label !== '' && label !== undefined &&
        <text className="edge-l" x={mid.x} y={mid.y}>{label}</text>}
    </>
  );
}

function Badges({ back, multi, tooBig }) {
  const notes = [];
  if (back) notes.push('cycle detected');
  if (multi) notes.push(`${multi} node${multi > 1 ? 's have' : ' has'} two parents`);
  if (tooBig) notes.push('large tree — scroll to pan');
  return (
    <g className="tbadges" transform="translate(6 14)">
      {notes.map((n, i) => <text key={n} y={i * 14} data-bad={i < 2 ? 1 : 0}>{n}</text>)}
    </g>
  );
}

/**
 * fit-to-union, not fit-to-visible.
 *
 * RENDERERS/00-OVERVIEW.md 2 offers both; a tree takes the first. The final
 * shape is small enough to read whole, and holding the camera still means the
 * picture fills in around a fixed frame — which is what makes "nothing moves"
 * legible rather than merely true. The recursion tree makes the other choice
 * because its final shape does not fit on a screen.
 */
function useCamera(layout, shape, s) {
  return useMemo(() => {
    if (shape.ids.length === 0) return { viewBox: '0 0 100 100', scroll: false, w: 0, h: 0 };
    const pad = NODE_R * 2;
    const w = Math.max(layout.maxX - layout.minX + pad * 2, 160);
    const h = Math.max(layout.maxY - layout.minY + pad * 2, 120);
    return {
      viewBox: `${layout.minX - pad} ${layout.minY - pad} ${w} ${h}`,
      // Past this width, scaling to fit stops being a favour: a complete
      // 63-node tree is ~1850 units across, and squeezing that into a pane
      // renders the 12px labels at about 6px -- it fits and cannot be read,
      // which is the worst of both. Beyond the threshold the SVG takes its
      // natural size and .pane-body (already overflow:auto) scrolls, so a
      // label is always the size it was designed to be. RENDERERS/TREE.md 6.
      scroll: w > SCROLL_ABOVE,
      w, h,
    };
  }, [layout, shape]);
}

/** ptr fields in declared order, falling back to whatever the schema declares. */
function ptrFields(schema) {
  const all = Object.entries(schema?.fields ?? {})
    .filter(([, k]) => k === 'ptr').map(([f]) => f);
  const order = (schema?.order ?? []).filter((f) => all.includes(f));
  // Declared order first, then anything the schema forgot to order, so a trie
  // with unordered children still draws rather than dropping edges.
  return [...order, ...all.filter((f) => !order.includes(f))];
}

const pt = (layout, ord) => ({ x: layout.x[ord], y: layout.y[ord] });

function edgeLive(now, pid, id, fields) {
  for (const f of fields) if (now.get(`${pid}|${f}`) === id) return true;
  return false;
}

function edgeLabel(s, id, field) {
  if (!field) return undefined;
  const v = s.get([id, field]);
  return v === null || v === undefined ? undefined : fmtValue(v);
}

/** node id -> the names pointing at it, so a node carries all of its chips. */
function invertRefs(refs) {
  const out = new Map();
  for (const [name, id] of Object.entries(refs ?? {})) {
    if (!id) continue;
    out.set(id, out.has(id) ? `${out.get(id)} ${name}` : name);
  }
  return out;
}

function countLive(shape, s) {
  let n = 0;
  for (const id of shape.ids) if (id && s.exists(id)) n++;
  return n;
}

/** A back edge curves so it cannot be mistaken for a tree edge. */
function arc(a, b) {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.6);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y + dx * 0.4}, ${b.x + dx} ${b.y - dx * 0.4}, ${b.x} ${b.y}`;
}
