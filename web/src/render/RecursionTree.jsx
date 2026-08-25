// @ts-check
import { memo, useMemo, useRef } from 'react';
import { addrKey, fmtValue } from '../lib/value.js';
import { tidyTree } from './layout/tidyTree.js';
import { resolveFocus } from './focus.js';

const MAX_SVG_NODES = 1500;
const NODE_H = 26;

/**
 * The flagship renderer: N-Queens, subsets, memoized DP.
 *
 * THE GROWTH PROBLEM, and how it is solved.
 *
 * A recursion tree grows as you step. If layout is recomputed from the
 * currently-visible subtree, every existing node moves whenever a new sibling
 * appears, and the picture reflows constantly. That is the defect that makes
 * most recursion-tree visualizers unwatchable.
 *
 * The fix is structural, not cosmetic. The trace is COMPLETE before the first
 * frame is drawn, so layout is a batch problem: lay out the ENTIRE call tree
 * once, at load, and render only the nodes whose call event has happened yet.
 * Nodes appear at coordinates they already had. NOTHING EVER MOVES -- by
 * construction, not by damping. ARCHITECTURE.md 5, ADR 0006.
 *
 * The camera pans over a rigid picture; that is not the same as things jumping.
 */
export default function RecursionTree({ store, spec, version, focus, onFocus }) {
  const tree = store.index.callTree;
  const boxRef = useRef(/** @type {SVGSVGElement|null} */(null));

  // Layout is memoised on the call tree's identity: computed once per trace,
  // never per step, and never inside a render pass that could be re-entered.
  const { layout, nodeW } = useMemo(() => {
    const labels = tree.nodes.map(nodeLabel);
    const w = Math.max(46, 12 + Math.max(4, ...labels.map((l) => l.length)) * 7);
    return {
      layout: tidyTree({ kids: tree.nodes.map((n) => n.kids), roots: tree.roots, depth: [] }, w, NODE_H),
      nodeW: w,
    };
  }, [tree]);

  const evIdx = store.eventIndex;
  const stack = new Set(store.callStack().map((f) => tree.byEvent.get(f.eventIdx)));
  const focusMode = tree.nodes.length > MAX_SVG_NODES;

  const visible = useVisible(tree, evIdx, stack, focusMode, focus);
  const view = useCamera(layout, visible, nodeW, focusMode, store.animating);
  const failWhen = spec.options?.failWhen ?? 'false';

  const cite = citationFor(focus, tree, layout, nodeW);
  // Both directions come from one place, so hovering a grid cell rings the
  // node that computed it and hovering a node rings the cells it wrote.
  const lit = resolveFocus(store, focus);

  // Every hook above runs unconditionally. React counts hooks by call order, so
  // an early return placed before them would change that count between renders
  // and produce "rendered fewer hooks than expected" the first time a trace
  // without calls is loaded.
  if (tree.nodes.length === 0) {
    return <div className="pane-note">this algorithm makes no calls</div>;
  }

  return (
    <svg className="rtree" ref={boxRef} viewBox={view.viewBox} preserveAspectRatio="xMidYMid meet">
      <g>
        {/* Edges first so node boxes paint over the line ends. */}
        {visible.map((ord) => {
          const n = tree.nodes[ord];
          if (n.parent < 0 || !visible.includes(n.parent)) return null;
          const live = stack.has(ord) && stack.has(n.parent);
          return (
            <line key={`e${ord}`} className="edge" data-live={live ? 1 : 0}
                  x1={layout.x[n.parent]} y1={layout.y[n.parent] + NODE_H / 2}
                  x2={layout.x[ord]} y2={layout.y[ord] - NODE_H / 2} />
          );
        })}

        {cite && <path className="citation" d={cite} />}

        {visible.map((ord) => (
          <Node key={ord} ord={ord} n={tree.nodes[ord]}
                x={layout.x[ord]} y={layout.y[ord]} w={nodeW}
                state={lifecycle(tree.nodes[ord], evIdx, stack, failWhen)}
                memo={tree.nodes[ord].isMemoHit}
                linked={lit.ords.has(ord)}
                onFocus={onFocus} />
        ))}
      </g>
      {focusMode && <Minimap layout={layout} tree={tree} evIdx={evIdx} view={view} />}
    </svg>
  );
}

const Node = memo(function Node({ ord, n, x, y, w, state, memo, linked, onFocus }) {
  const label = nodeLabel(n);
  const ret = n.retEvent >= 0 ? fmtValue(n.retValue) : '';
  return (
    <g className="node enter" data-state={state} data-memo={memo ? 1 : 0}
       data-linked={linked ? 1 : 0}
       data-anchor={`$calls ${ord}`}
       transform={`translate(${x} ${y})`}
       onMouseEnter={() => onFocus?.({ kind: 'call', event: n.id, ord })}
       onMouseLeave={() => onFocus?.(null)}>
      <rect x={-w / 2} y={-NODE_H / 2} width={w} height={NODE_H} />
      <text y={ret ? -4 : 0}>{label}{memo ? ' ~' : ''}</text>
      {ret && <text y={8} style={{ fontSize: 9, opacity: 0.75 }}>= {ret}</text>}
    </g>
  );
}, (a, b) => a.state === b.state && a.memo === b.memo && a.linked === b.linked &&
             a.x === b.x && a.y === b.y && a.n.retEvent === b.n.retEvent);

function nodeLabel(n) {
  const args = (n.args ?? []).map((a) => fmtValue(a.v)).join(',');
  return `${n.fn}(${args})`;
}

/**
 * Lifecycle, derived entirely from the current event index and the stack.
 *
 * `fail` is what makes PRUNING visible: in N-Queens whole subtrees dim to rose
 * as the search abandons them while the live path stays bright. It comes from
 * the return value alone -- no algorithm-specific code anywhere.
 *
 * The truthiness rule is a heuristic and will occasionally be wrong (an
 * algorithm returning 0 as a valid answer), so `failWhen` defaults to strict
 * `false` rather than falsy. Documented rather than clever.
 */
function lifecycle(n, evIdx, stack, failWhen) {
  if (stack.has(n.ord)) return 'live';
  if (n.retEvent < 0 || n.retEvent >= evIdx) return 'live';
  const v = n.retValue;
  const failed = failWhen === 'falsy' ? !v : failWhen === 'null' ? v === null : v === false;
  return failed ? 'fail' : 'ok';
}

/**
 * Which nodes to draw.
 *
 * Past MAX_SVG_NODES this switches to FOCUS MODE -- ancestors, their siblings,
 * and the current subtree to depth 2. Culling is safe precisely because layout
 * is static: a culled node reappears in exactly its old position, so culling
 * causes no movement. That is the property that makes it acceptable rather than
 * disorienting.
 */
function useVisible(tree, evIdx, stack, focusMode, focus) {
  return useMemo(() => {
    const born = [];
    for (let ord = 0; ord < tree.nodes.length; ord++) {
      if (tree.nodes[ord].id < evIdx) born.push(ord);
    }
    if (!focusMode) return born;

    const keep = new Set();
    const add = (o) => { if (o >= 0 && tree.nodes[o].id < evIdx) keep.add(o); };
    for (const ord of stack) {
      let cur = ord;
      while (cur >= 0) {
        add(cur);
        for (const sib of siblingsOf(tree, cur).slice(0, 12)) add(sib);
        cur = tree.nodes[cur].parent;
      }
      for (const d of descendants(tree, ord, 2)) add(d);
    }
    if (focus?.ord !== undefined) add(focus.ord);
    return [...keep].sort((a, b) => a - b);
  }, [tree, evIdx, focusMode, focus?.ord, stack.size]);
}

function siblingsOf(tree, ord) {
  const p = tree.nodes[ord].parent;
  return p < 0 ? tree.roots : tree.nodes[p].kids;
}

function descendants(tree, ord, depth) {
  const out = [];
  const walk = (o, d) => {
    out.push(o);
    if (d === 0) return;
    for (const k of tree.nodes[o].kids) walk(k, d - 1);
  };
  walk(ord, depth);
  return out;
}

/**
 * The camera fits the visible bounding box, with HYSTERESIS so it does not
 * creep every step, and it never re-fits mid-scrub. Relative positions are
 * constant; this is a pan and zoom of a rigid picture.
 */
function useCamera(layout, visible, nodeW, focusMode, animate) {
  const last = useRef({ viewBox: '0 0 100 100', box: null });
  return useMemo(() => {
    if (visible.length === 0) return last.current;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const ord of visible) {
      minX = Math.min(minX, layout.x[ord]);
      maxX = Math.max(maxX, layout.x[ord]);
      minY = Math.min(minY, layout.y[ord]);
      maxY = Math.max(maxY, layout.y[ord]);
    }
    const pad = nodeW;
    const box = { x: minX - pad, y: minY - NODE_H, w: (maxX - minX) + pad * 2, h: (maxY - minY) + NODE_H * 3 };
    const prev = last.current.box;
    // Hysteresis: only re-fit when the needed box escapes the current one by
    // more than 12%, so the camera settles instead of creeping.
    if (prev && box.x >= prev.x && box.y >= prev.y &&
        box.x + box.w <= prev.x + prev.w * 1.12 &&
        box.y + box.h <= prev.y + prev.h * 1.12) {
      return last.current;
    }
    last.current = { viewBox: `${box.x} ${box.y} ${Math.max(box.w, 120)} ${Math.max(box.h, 80)}`, box };
    return last.current;
  }, [layout, visible.length, nodeW, focusMode]);
}

/**
 * The memo-hit citation edge.
 *
 * Not drawn by default -- with 200 memo hits the picture becomes a hairball.
 * It appears on hover of either endpoint, as a quadratic curve back to the node
 * that originally computed that value. This is the single most convincing
 * detail in the demo, because it makes "memoization = reuse" a thing you can
 * point at. The source was resolved in the pre-pass from firstWrite, entirely
 * structurally. ADR 0005.
 */
function citationFor(focus, tree, layout, nodeW) {
  if (!focus || focus.ord === undefined) return null;
  const n = tree.nodes[focus.ord];
  if (!n || !n.isMemoHit || n.memoSrc < 0) return null;
  const a = { x: layout.x[focus.ord], y: layout.y[focus.ord] };
  const b = { x: layout.x[n.memoSrc], y: layout.y[n.memoSrc] };
  const mx = (a.x + b.x) / 2;
  const my = Math.min(a.y, b.y) - Math.max(40, Math.abs(a.x - b.x) / 3);
  return `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
}

/**
 * The minimap: the whole tree at one dot per node, with the current path
 * highlighted. Converts "this tree is too big to show" into "here is the whole
 * search, and here is where you are" -- a better story anyway.
 */
function Minimap({ layout, tree, evIdx, view }) {
  const W = 160, H = 110;
  const sx = W / Math.max(1, layout.maxX - layout.minX);
  const sy = H / Math.max(1, layout.maxY - layout.minY);
  const s = Math.min(sx, sy);
  return (
    <g className="minimap" transform={`translate(8 8)`} style={{ pointerEvents: 'none' }}>
      <rect className="bg" x={0} y={0} width={W} height={H} rx="4" opacity="0.9" />
      {tree.nodes.map((n, ord) => (
        <circle key={ord} r={0.8}
                className={n.id < evIdx ? 'on' : ''}
                cx={(layout.x[ord] - layout.minX) * s}
                cy={(layout.y[ord] - layout.minY) * s} />
      ))}
    </g>
  );
}
