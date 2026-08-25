// @ts-check
import { memo, useMemo } from 'react';
import { addrKey, fmtValue } from '../lib/value.js';
import { useReadSet } from './Linear.jsx';
import { resolveFocus } from './focus.js';

/**
 * DP tables, matrices, boards, adjacency matrices.
 *
 * A real <table>, not a CSS grid of divs and definitely not SVG. A DP table IS
 * a table: it has row headers, column headers and a reading order. <th
 * scope="row"> gives a screen reader "row A, column G, 2" with no extra work,
 * the whole thing copy-pastes into a spreadsheet, and text renders at the OS's
 * hinting quality. ADR 0011.
 */
export default function Grid({ store, spec, version, focus, onFocus }) {
  const s = store.struct(spec.s);
  if (!s) return <div className="pane-note">not created yet</div>;

  const [rows, cols] = s.dims ?? [0, 0];
  if (!rows || !cols) return <div className="pane-note">table not created yet</div>;

  const union = store.index.structUnion.get(spec.s);
  const role = spec.options?.role ?? 'dp';
  const glyphs = spec.options?.glyphs ?? null;
  const answer = spec.options?.answer ?? null;
  const showHeads = role !== 'board' && !!s.labels;

  const cell = useMemo(() => {
    const w = Math.max(1, union?.maxValueWidth ?? 1);
    return Math.max(26, Math.min(16 + w * 9, cols > 12 ? 30 : cols > 8 ? 36 : 44));
  }, [union, cols]);

  const changed = store.changed();
  const reads = useReadSet(store);
  const trail = useTrail(store, spec.options?.trail ?? 0, spec.s);
  const evIdx = store.eventIndex;
  const lit = resolveFocus(store, focus);

  return (
    <table className="grid" style={{ '--cw': `${cell}px`, '--cell': `${cell}px` }}>
      {showHeads && (
        <thead>
          <tr>
            <th />
            {range(cols).map((c) => <th key={c} scope="col">{s.labels?.cols?.[c] ?? c}</th>)}
          </tr>
        </thead>
      )}
      <tbody>
        {range(rows).map((r) => (
          <tr key={r}>
            {showHeads && <th className="rowhead" scope="row">{s.labels?.rows?.[r] ?? r}</th>}
            {range(cols).map((c) => {
              const at = [r, c];
              const key = addrKey(spec.s, at);
              const first = store.index.firstWrite.get(key);
              return (
                <GCell key={c} r={r} c={c}
                       v={s.get(at)}
                       glyph={glyphs ? glyphs[String(s.get(at))] : undefined}
                       filled={first !== undefined && first < evIdx}
                       w={changed.has(key)}
                       rd={reads.has(key)}
                       trail={trail.get(key)}
                       settled={!!answer && answer[0] === r && answer[1] === c}
                       linked={lit.cells.has(key)}
                       label={headLabel(s, r, c)}
                       s={spec.s} at={at} onFocus={onFocus} />
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const GCell = memo(function GCell({ r, c, v, glyph, filled, w, rd, trail, settled, linked, label, s, at, onFocus }) {
  const text = glyph !== undefined ? glyph : fmtValue(v);
  return (
    <td>
      <div className="gcell num"
           data-w={w ? 1 : 0} data-r={rd ? 1 : 0}
           data-filled={filled ? 1 : 0}
           data-settled={settled ? 1 : 0}
           data-linked={linked ? 1 : 0}
           data-trail={trail !== undefined ? trail : undefined}
           style={trail !== undefined ? { opacity: 1, filter: `saturate(${1 - trail * 0.1})` } : undefined}
           data-anchor={addrKey(s, at)}
           tabIndex={0}
           aria-label={`${label}, ${fmtValue(v)}`}
           onMouseEnter={() => onFocus?.({ kind: 'cell', s, at })}
           onMouseLeave={() => onFocus?.(null)}
           // Keyboard focus publishes the same address as hover. The cell was
           // already tabbable; without this, tabbing to it highlighted nothing
           // and the watch/breakpoint keys had no address to act on.
           onFocus={() => onFocus?.({ kind: 'cell', s, at })}
           onBlur={() => onFocus?.(null)}>
        {text}
      </div>
    </td>
  );
}, (a, b) =>
  a.v === b.v && a.w === b.w && a.rd === b.rd && a.filled === b.filled &&
  a.trail === b.trail && a.settled === b.settled && a.linked === b.linked && a.glyph === b.glyph);

/**
 * The fill-order trail: the last N written cells, with decaying emphasis.
 *
 * Twelve lines, and one of the highest-value-per-line features in the project.
 * It turns the DP fill order into something you can SEE -- row-major for
 * bottom-up LCS, and a scattered jumping-around for a memoized top-down
 * solution. That contrast is the entire visual argument for why memoization is
 * not the same as bottom-up DP.
 */
function useTrail(store, n, structName) {
  return useMemo(() => {
    const out = new Map();
    if (!n) return out;
    let depth = 0;
    for (let k = store.step - 2; k >= 0 && depth < n; k--) {
      const st = store.steps[k];
      for (let i = st.e1 - 1; i >= st.e0; i--) {
        const e = store.trace.events[i];
        if (e.t === 'set' && e.s === structName) {
          const key = addrKey(e.s, e.at ?? []);
          if (!out.has(key)) { out.set(key, depth); depth++; }
        }
      }
    }
    return out;
  }, [store, store.version, n, structName]);
}

function headLabel(s, r, c) {
  const rl = s.labels?.rows?.[r] ?? `row ${r}`;
  const cl = s.labels?.cols?.[c] ?? `column ${c}`;
  return `${rl || `row ${r}`}, ${cl || `column ${c}`}`;
}

const range = (n) => Array.from({ length: Math.max(0, n) }, (_, i) => i);
