// @ts-check
import { fmtValue } from '../lib/value.js';

/**
 * The call stack. Cheapest renderer in the project and one of the most useful.
 *
 * Two details that matter more than they look:
 *
 *  - Newest at the BOTTOM, growing downward. That is how every textbook and
 *    every debugger draws it; growing upward is technically defensible and
 *    confuses everyone.
 *  - The return ghost. Without it a return is invisible -- a frame simply
 *    vanishes and the viewer misses which value came back.
 */
export default function CallStackPane({ store, version, focus, onFocus }) {
  if (!store) return null;
  const frames = store.callStack();
  const ret = store.lastReturn();
  if (frames.length === 0 && !ret) return null;

  const shown = collapseMiddle(frames, 12);

  return (
    <>
      <div className="section-head">
        Call stack
        <span style={{ marginLeft: 'auto', textTransform: 'none' }}>depth {frames.length}</span>
      </div>
      <ol className="callstack" style={{ overflow: 'auto', maxHeight: 220 }}>
        {shown.map((f, i) =>
          f.gap ? (
            <li key={`gap${i}`} className="frame-gap">… {f.count} more frames …</li>
          ) : (
            <li key={f.eventIdx} className="frame"
                data-top={i === shown.length - 1 ? 1 : 0}
                data-linked={focus?.kind === 'call' && focus.event === f.eventIdx ? 1 : 0}
                style={{ opacity: 0.55 + 0.45 * ((i + 1) / shown.length) }}
                onMouseEnter={() => onFocus?.({ kind: 'call', event: f.eventIdx })}
                onMouseLeave={() => onFocus?.(null)}
                onClick={() => seekToEvent(store, f.eventIdx)}>
              <span>{label(f)}</span>
              <span className="idx">#{f.eventIdx}</span>
            </li>
          ))}
        {ret && (
          <li className="ret-ghost">returned {fmtValue(ret.v)}</li>
        )}
      </ol>
    </>
  );
}

function label(f) {
  const args = (f.args ?? []).map((a) => `${a.n}=${fmtValue(a.v)}`).join(', ');
  return `${f.fn}(${args})`;
}

/**
 * Collapse the MIDDLE, not the top. The top is where the action is and the
 * bottom is the context; the middle is almost always a uniform run of the same
 * function.
 */
function collapseMiddle(frames, max) {
  if (frames.length <= max) return frames;
  const keepBottom = 8, keepTop = 4;
  return [
    ...frames.slice(0, keepBottom),
    { gap: true, count: frames.length - keepBottom - keepTop },
    ...frames.slice(frames.length - keepTop),
  ];
}

/** Clicking a frame seeks to the step that pushed it -- one line, because the
 *  frame already carries its event index. */
function seekToEvent(store, eventIdx) {
  const k = store.steps.findIndex((s) => eventIdx >= s.e0 && eventIdx < s.e1);
  if (k >= 0) store.seek(k + 1);
}
