// @ts-check
import { useLayoutEffect, useRef, useState } from 'react';
import { rendererFor, resolveViews, PLANNED } from '../render/registry.js';
import ErrorBoundary from './ErrorBoundary.jsx';
import { resolveFocus } from '../render/focus.js';

/**
 * One or two panes.
 *
 * THERE IS NO SYNCHRONIZATION PROBLEM, and that is the payoff of the whole
 * design: both panes are pure functions of the same store, so they cannot
 * drift. What actually needed building is the FOCUS protocol -- a single
 * nullable object in context that panes use to highlight each other -- and the
 * connector drawn between them.
 */
export default function ViewGrid({ store, trace, version, focus, onFocus, onPin }) {
  const views = resolveViews(trace);
  const wrapRef = useRef(/** @type {HTMLDivElement|null} */(null));

  if (!store) return <div className="pane" />;
  if (views.length === 0) {
    return <div className="pane"><div className="pane-body">
      <p className="pane-note">This trace declares no views.</p>
    </div></div>;
  }

  return (
    <div className="panes" ref={wrapRef} style={{ position: 'relative', flex: 1, minHeight: 0 }}>
      {views.map((spec, i) => (
        <ViewPane key={`${spec.family}:${spec.s}:${i}`} spec={spec}
                  store={store} version={version}
                  focus={focus} onFocus={onFocus} onPin={onPin} />
      ))}
      <Connector wrapRef={wrapRef} focus={focus} store={store} version={version} />
    </div>
  );
}

function ViewPane({ spec, store, version, focus, onFocus, onPin }) {
  const Renderer = rendererFor(spec.family);
  // A structure two rows tall does not need an equal share of the column. The
  // memo table in coins-memo is 1x12 -- 57px of content in a 256px pane -- and
  // the height it was given came out of the recursion tree, which is the pane
  // that could actually use it.
  const compact = isCompact(spec, store);
  const unknown = !Renderer || (PLANNED.has(spec.family) && Renderer.name === 'Fallback');
  return (
    <section className="pane" data-family={spec.family} data-compact={compact ? 1 : 0}>
      <div className="pane-head">
        <span className="title">{spec.title ?? spec.s}</span>
        <span style={{ marginLeft: 'auto', textTransform: 'none' }}>{spec.family}</span>
      </div>
      <div className="pane-body"
           onClick={(e) => { if (e.target === e.currentTarget) onPin?.(null); }}>
        {/* A per-pane error boundary is the one that saves a demo: a bug in one
            layout must not blank the app. */}
        <ErrorBoundary label={spec.title ?? spec.s}>
          <Renderer store={store} spec={spec} version={version}
                    focus={focus} onFocus={onFocus} onPin={onPin}
                    note={unknown ? `No renderer for "${spec.family}" yet — showing the raw structure.` : undefined} />
        </ErrorBoundary>
      </div>
    </section>
  );
}

/**
 * The dashed arc between a tree node and its grid cell.
 *
 * Drawn by ViewGrid rather than by either pane, from the bounding rects of two
 * elements carrying `data-anchor`. Panes EXPOSE anchors; they never draw
 * between themselves, and they hold no reference to each other.
 *
 * About forty lines, and the single most photogenic thing in the app. Build it
 * last: it is polish, and it is the polish people screenshot.
 */
function Connector({ wrapRef, focus, store, version }) {
  const [d, setD] = useState('');

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !focus) { setD(''); return; }

    const anchors = resolveAnchors(focus, store);
    if (anchors.length < 2) { setD(''); return; }

    const rects = anchors
      .map((sel) => wrap.querySelector(`[data-anchor="${cssEscape(sel)}"]`))
      .filter(Boolean)
      .map((el) => el.getBoundingClientRect());
    if (rects.length < 2) { setD(''); return; }

    const box = wrap.getBoundingClientRect();
    const p = rects.map((r) => ({ x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top }));
    const [a, b] = p;
    const dx = Math.abs(b.x - a.x) * 0.4 + 30;
    setD(`M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`);
  }, [focus, version, wrapRef, store]);

  if (!d) return null;
  return (
    <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
      <path d={d} fill="none" stroke="var(--read)" strokeWidth="1.5"
            strokeDasharray="4 3" opacity="0.9" />
    </svg>
  );
}

/**
 * The connector's two endpoints, from the shared focus protocol.
 *
 * A memo-hit node deliberately yields no cell endpoint: its range contains no
 * writes, because the whole point of a memo hit is that no work happened. The
 * citation arc inside the tree is the right visual there, so returning nothing
 * is correct rather than a gap.
 */
function resolveAnchors(focus, store) {
  const lit = resolveFocus(store, focus);
  const ord = [...lit.ords][0];
  const cell = [...lit.cells][0];
  if (ord === undefined || cell === undefined) return [];
  return [`$calls ${ord}`, cell];
}

/**
 * Whether a view should size to its content rather than take a share of the
 * column.
 *
 * Read from the DECLARED dims, not from what has been written so far, so the
 * pane does not resize as the run fills the table -- the same reason layout
 * runs on the union. A structure with no declared dims is not compact, because
 * a tree or a graph can grow without limit and a pane that grew with it would
 * push everything else off screen.
 */
function isCompact(spec, store) {
  const u = store?.index?.structUnion?.get(spec.s);
  const dims = u?.dims;
  if (!Array.isArray(dims)) return false;
  const rows = dims.length === 1 ? 1 : dims[0];
  return rows <= 2;
}

const cssEscape = (s) => s.replace(/(["\\])/g, '\\$1');
