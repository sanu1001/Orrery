// @ts-check
import { useMemo } from 'react';
import { addrKey, fmtValue } from '../lib/value.js';

/**
 * The collapsible text view. Handles ANY structure.
 *
 * Built first, on purpose, for three reasons in order of importance:
 *
 *  1. It makes the player testable on day one. You can verify forward,
 *     backward, grouping and provenance against a text view before writing a
 *     line of SVG. Debugging the player through a half-finished tree renderer
 *     is how two days disappear.
 *  2. It is the safety net. A user's trace can contain any structure shape; a
 *     renderer that shows nothing makes the product look broken, one that shows
 *     the raw state makes it look deliberate.
 *  3. It is the honest floor. Every claim about renderer decoupling is
 *     demonstrated by a renderer that knows nothing at all.
 */
export default function Fallback({ store, spec, version, note }) {
  const s = store.struct(spec.s);
  const changed = store.changed();
  const reads = useMemo(() => {
    const out = new Set();
    for (const e of store.currentEvents()) for (const d of e.deps ?? []) out.add(addrKey(d.s, d.at ?? []));
    return out;
  }, [store, version]);

  if (!s) return <div className="pane-note">not created yet</div>;
  const rows = flatten(s);

  return (
    <div className="fallback">
      {note && <p className="pane-note">{note}</p>}
      <details open={rows.length <= 24}>
        <summary>
          {s.name} <span className="dim">{s.kind}, {rows.length} cell{rows.length === 1 ? '' : 's'}</span>
        </summary>
        {rows.length === 0 && <div className="pane-note">no cells yet</div>}
        {rows.slice(0, 200).map((r) => (
          <div key={r.key} className="fbrow"
               data-w={changed.has(r.key) ? 1 : 0}
               data-r={reads.has(r.key) ? 1 : 0}>
            <span className="k">{r.path}</span>
            <span className="v">{fmtValue(r.value)}</span>
          </div>
        ))}
        {rows.length > 200 && <div className="pane-note">… {rows.length - 200} more</div>}
      </details>
    </div>
  );
}

/**
 * Rows sorted with a NUMERIC-AWARE comparator, which is the only subtle thing
 * in this file: lexicographically, "10" sorts before "2", and a memo table that
 * reads out of order is worse than no memo table.
 */
function flatten(s) {
  const out = [];
  if (s.isNodeKind) {
    for (const k of Object.keys(s.root)) leaves(out, s, k, s.root[k]);
  } else {
    for (const [k, v] of s.flat) out.push({ key: addrKey(s.name, k.split('/')), path: k, value: v });
  }
  out.sort((a, b) => cmpPath(a.path, b.path));
  return out;
}

function leaves(out, s, prefix, v) {
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && typeof v.$ !== 'string') {
    for (const k of Object.keys(v)) leaves(out, s, prefix + '/' + k, v[k]);
    return;
  }
  out.push({ key: s.name + ' ' + prefix, path: prefix, value: v });
}

function cmpPath(a, b) {
  const as = a.split('/'), bs = b.split('/');
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const x = as[i], y = bs[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = Number(x), ny = Number(y);
    const bothNum = Number.isInteger(nx) && Number.isInteger(ny);
    if (bothNum && nx !== ny) return nx - ny;
    if (!bothNum && x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
