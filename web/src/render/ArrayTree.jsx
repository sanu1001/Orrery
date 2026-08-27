// @ts-check
import { memo, useMemo } from 'react';
import { addrKey, fmtValue } from '../lib/value.js';
import { tidyTree } from './layout/tidyTree.js';
import { heapShape } from './layout/heapShape.js';
import { useReadSet } from './Linear.jsx';
import { resolveFocus } from './focus.js';
import { resolveCursors } from './CursorChip.jsx';

const NODE_R = 20;
const LEVEL_H = 66;
const SIB_GAP = 14;
const SCROLL_ABOVE = 820;

/**
 * The same array, read as a tree.
 *
 * Not a family of its own and not a second structure -- it is the SAME
 * `kind:"array"` state that Linear draws in a row, laid out by the implicit
 * children in heapShape.js. `options.alsoAs: "tree"` is what offers the toggle.
 *
 * That is the whole of B4, and it is why heaps and segment trees cost hours
 * rather than a renderer family. The pair of views is also a better teacher
 * than either alone: a sift-down is obviously right in the tree and obviously
 * cheap in the array, and only seeing both at once says why the structure is
 * worth having.
 *
 * It reuses the tree family's DOM shape and stylesheet unchanged -- same
 * `.tnode`, same `data-w`/`data-r`/`data-linked` attributes -- so "amber means
 * written this step" needs no second implementation.
 */
export default function ArrayTree({ store, spec, version, focus, onFocus, onPin }) {
  const s = store.struct(spec.s);
  const union = store.index.structUnion.get(spec.s);
  const n = s?.dims?.[0] ?? 0;
  const arity = spec.options?.arity ?? 2;

  const layout = useMemo(() => {
    const { kids, roots } = heapShape(n, arity);
    // Width from the union's widest value, exactly as the row does, so
    // switching views does not resize anything.
    const w = Math.max(NODE_R * 2, 14 + (union?.maxValueWidth ?? 1) * 9);
    return tidyTree({ kids, roots, depth: [] }, w, NODE_R * 2, SIB_GAP, LEVEL_H - NODE_R * 2);
  }, [n, arity, union]);

  const changed = store.changed();
  const reads = useReadSet(store);
  const lit = resolveFocus(store, focus);
  const cursors = resolveCursors(store, spec.options?.cursors, n);
  const subLabel = spec.options?.subLabelOf ? store.struct(spec.options.subLabelOf) : null;
  // A live length -- a heap being sorted in place shrinks, and the cells past
  // the end are sorted output rather than heap. Read from a scalar the
  // algorithm writes, so nothing is inferred.
  const live = spec.options?.sizeOf ? store.struct(spec.options.sizeOf)?.get([]) : null;
  // A second way to say "this node is finished", for a structure that has no
  // moving boundary: a segment-tree query marks the handful of nodes whose
  // sums it actually used. One attribute, two ways to reach it.
  const mark = spec.options?.markOf ? store.struct(spec.options.markOf) : null;

  if (!s) return <div className="pane-note">not created yet</div>;
  if (n === 0) return <div className="pane-note">empty</div>;

  const { kids } = heapShape(n, arity);
  const pad = NODE_R * 2;
  const w = Math.max(layout.maxX - layout.minX + pad * 2, 160);
  const h = Math.max(layout.maxY - layout.minY + pad * 2, 120);
  const chipAt = new Map();
  for (const c of cursors) {
    if (c.parked) continue;
    chipAt.set(c.index, chipAt.has(c.index) ? `${chipAt.get(c.index)} ${c.name}` : c.name);
  }

  return (
    <svg className="tree arraytree" viewBox={`${layout.minX - pad} ${layout.minY - pad} ${w} ${h}`}
         preserveAspectRatio="xMidYMid meet"
         style={w > SCROLL_ABOVE ? { width: w, height: h, flex: 'none' } : undefined}>
      <g>
        {kids.map((row, i) => row.map((c) => (
          <line key={`e${c}`} className="edge"
                data-done={done(live, mark, c) ? 1 : 0}
                x1={layout.x[i]} y1={layout.y[i] + NODE_R}
                x2={layout.x[c]} y2={layout.y[c] - NODE_R} />
        )))}

        {kids.map((_, i) => {
          const at = [i];
          const key = addrKey(spec.s, at);
          return (
            <ATNode key={i} i={i} s={spec.s} at={at}
                    x={layout.x[i]} y={layout.y[i]}
                    v={fmtValue(s.get(at))}
                    sub={subLabel ? fmtValue(subLabel.get([String(i)])) : ''}
                    w={changed.has(key)}
                    rd={reads.has(key)}
                    ring={chipAt.get(i) ?? ''}
                    done={done(live, mark, i)}
                    linked={lit.cells.has(key)}
                    onFocus={onFocus} onPin={onPin} />
          );
        })}
      </g>
    </svg>
  );
}

/** Whether index i is finished: out of the live heap, or explicitly marked. */
function done(live, mark, i) {
  if (typeof live === 'number' && i >= live) return true;
  const v = mark ? mark.get([String(i)]) : null;
  return v === true || (typeof v === 'number' && v !== 0);
}

const ATNode = memo(function ATNode({ i, s, at, x, y, v, sub, w, rd, ring, done, linked, onFocus, onPin }) {
  return (
    <g className="tnode enter" data-w={w ? 1 : 0} data-r={rd ? 1 : 0}
       data-ring={ring} data-linked={linked ? 1 : 0} data-done={done ? 1 : 0}
       data-anchor={addrKey(s, at)}
       tabIndex={0}
       aria-label={`index ${i}, value ${v}${sub ? `, ${sub}` : ''}`}
       transform={`translate(${x} ${y})`}
       onMouseEnter={() => onFocus?.({ kind: 'cell', s, at })}
       onMouseLeave={(e) => {
         if (document.activeElement !== e.currentTarget) onFocus?.(null);
       }}
       onFocus={() => onFocus?.({ kind: 'cell', s, at })}
       onBlur={() => onFocus?.(null)}
       onClick={() => onPin?.({ kind: 'cell', s, at })}>
      <circle r={NODE_R} />
      <text y={4}>{v}</text>
      {/* The index is the bridge between the two views: it is what the row
          calls this cell, so it has to be visible in the tree or the toggle is
          two unrelated pictures. */}
      <text className="ix" y={-NODE_R - 6}>{i}</text>
      {sub !== '' && <text className="sub" y={NODE_R + 14}>{sub}</text>}
      {ring !== '' && <text className="refchip" y={NODE_R + (sub ? 26 : 14)}>{ring}</text>}
    </g>
  );
}, (a, b) => a.v === b.v && a.sub === b.sub && a.w === b.w && a.rd === b.rd &&
             a.ring === b.ring && a.done === b.done && a.linked === b.linked &&
             a.x === b.x && a.y === b.y);
