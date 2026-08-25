// @ts-check
import { memo, useMemo } from 'react';
import { fmtValue, addrKey } from '../lib/value.js';
import CursorChip, { resolveCursors } from './CursorChip.jsx';
import { resolveFocus } from './focus.js';

/**
 * Arrays, stacks, queues, sliding windows, and integer-keyed maps.
 *
 * HTML, not SVG. The cells are boxes in a row with numbers in them, and HTML
 * gives tabular-nums, text selection, real :hover, real focus rings and screen
 * reader order for free. SVG would give none of those and would need manual
 * text centring. ADR 0011.
 */
export default function Linear({ store, spec, version, focus, onFocus }) {
  const s = store.struct(spec.s);
  if (!s) return <div className="pane-note">not created yet</div>;

  const union = store.index.structUnion.get(spec.s);
  const isMap = s.kind === 'map';
  const length = isMap ? mapLength(union) : (s.dims?.[0] ?? 0);

  // Cell width is sized from the UNION -- everything the structure will ever
  // hold -- not from current state. Without that, a cell going from 9 to 1000
  // widens on the step it changes and the whole row shifts. Small thing,
  // very visible defect.
  const cellW = useMemo(() => {
    const w = Math.max(2, union?.maxValueWidth ?? 2);
    const byText = 16 + w * 9;
    const byCount = length > 24 ? 30 : length > 14 ? 36 : 44;
    return Math.max(26, Math.min(byText, byCount));
  }, [union, length]);

  const changed = store.changed();
  const reads = useReadSet(store);
  const lit = resolveFocus(store, focus);
  const cursors = resolveCursors(store, spec.options?.cursors, length);
  const regions = resolveRegions(store, spec.options?.regions, length);
  const chips = (spec.options?.chips ?? []).map((n) => ({ name: n, value: store.struct(n)?.get([]) }));

  if (length === 0) {
    return <div className="pane-note">empty</div>;
  }

  return (
    <div className="linear" style={{ '--cw': `${cellW}px` }}>
      {chips.length > 0 && (
        <div className="counter" style={{ marginBottom: 4 }}>
          {chips.map((c) => `${c.name} = ${fmtValue(c.value)}`).join('   ')}
        </div>
      )}

      <div className="chips" style={{ height: 20 + 20 * maxStack(cursors) }}>
        {cursors.map((c) => (
          <CursorChip key={c.name} {...c} cellW={cellW} animate={store.animating} />
        ))}
      </div>

      <div className="region-bands">
        {regions.map((r) => (
          <span key={r.name} className="band" data-style={r.style}
                style={{ left: r.from * (cellW + 4), width: Math.max(0, (r.to - r.from + 1)) * (cellW + 4) - 4 }} />
        ))}
      </div>

      <div className="linear-row" role="list">
        {range(length).map((i) => {
          const at = isMap ? [String(i)] : [i];
          const key = addrKey(spec.s, at);
          return (
            <Cell key={i} i={i}
                  v={s.get(at)}
                  w={changed.has(key)}
                  r={reads.has(key)}
                  settled={regionStyleAt(regions, i) === 'settled'}
                  linked={lit.cells.has(key)}
                  cursor={cursors.some((c) => !c.parked && c.index === i)}
                  onFocus={onFocus}
                  s={spec.s} at={at} />
          );
        })}
      </div>

      {length <= 40 && (
        <div className="linear-rail" aria-hidden="true">
          {range(length).map((i) => <span key={i}>{i}</span>)}
        </div>
      )}
    </div>
  );
}

/**
 * The performance-critical line in this file is the comparator: a step touches
 * one to three cells, and the other ninety-seven must not re-render when the
 * store's version integer changes.
 */
const Cell = memo(function Cell({ i, v, w, r, settled, cursor, linked, onFocus, s, at }) {
  return (
    <div className="cell num" role="listitem"
         data-w={w ? 1 : 0} data-r={r ? 1 : 0}
         data-settled={settled ? 1 : 0} data-cursor={cursor ? 1 : 0}
         data-linked={linked ? 1 : 0}
         data-anchor={addrKey(s, at)}
         tabIndex={0}
         aria-label={`index ${i}, value ${fmtValue(v)}`}
         onMouseEnter={() => onFocus?.({ kind: 'cell', s, at })}
         onMouseLeave={() => onFocus?.(null)}
         // Keyboard focus publishes the same address as hover. The cell was
         // already tabbable; without this, tabbing to it highlighted nothing
         // and the watch/breakpoint keys had no address to act on.
         onFocus={() => onFocus?.({ kind: 'cell', s, at })}
         onBlur={() => onFocus?.(null)}>
      {fmtValue(v)}
    </div>
  );
}, (a, b) =>
  a.v === b.v && a.w === b.w && a.r === b.r &&
  a.settled === b.settled && a.cursor === b.cursor && a.linked === b.linked);

/** Addresses read by the current step, from the events' deps. */
export function useReadSet(store) {
  return useMemo(() => {
    const out = new Set();
    for (const e of store.currentEvents()) {
      for (const d of e.deps ?? []) out.add(addrKey(d.s, d.at ?? []));
    }
    return out;
  }, [store, store.version]);
}

/**
 * Region bands are declared as {from, to} where each endpoint is EITHER a
 * literal index OR the name of a scalar structure. Naming a scalar is what
 * makes a sliding window animate for free: the band moves because the same
 * events that move the pointers move it, with no renderer-side inference and
 * no `slidingWindow` family.
 */
function resolveRegions(store, decls, length) {
  const out = [];
  for (const d of decls ?? []) {
    const from = resolveBound(store, d.from, 0);
    const to = resolveBound(store, d.to, length - 1);
    if (from > to || to < 0) continue;
    out.push({ name: d.name, style: d.style ?? 'settled',
               from: Math.max(0, from), to: Math.min(length - 1, to) });
  }
  return out;
}

function resolveBound(store, b, dflt) {
  if (typeof b === 'number') return b;
  if (typeof b === 'string') {
    const v = store.struct(b)?.get([]);
    return typeof v === 'number' ? v : dflt;
  }
  return dflt;
}

function regionStyleAt(regions, i) {
  for (const r of regions) if (i >= r.from && i <= r.to) return r.style;
  return null;
}

function mapLength(union) {
  let max = -1;
  for (const k of union?.keys ?? []) {
    const n = Number(k);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max + 1;
}

const maxStack = (cs) => cs.reduce((m, c) => Math.max(m, c.stack), 0);
const range = (n) => Array.from({ length: Math.max(0, n) }, (_, i) => i);
