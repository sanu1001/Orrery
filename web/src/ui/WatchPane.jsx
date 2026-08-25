// @ts-check
import { useMemo } from 'react';
import { addrKey, addrLabel, fmtValue } from '../lib/value.js';
import { history } from '../player/breakpoints.js';

/**
 * The debugger rail: watched addresses and breakpoints.
 *
 * WHAT MAKES THIS CHEAP. A watch's change history is not stored anywhere — it
 * is recovered by scanning the trace for writes to one address, and the trace
 * is already complete and already in memory. So "this cell was written four
 * times, take me to the third" costs a linear scan and a seek, and works
 * backward as readily as forward.
 *
 * NO RENDERER KNOWS THIS EXISTS. A watch is an address, and the focus protocol
 * already hands panes addresses on hover and click, so every pane became
 * watchable without being touched. That is I2 holding by construction rather
 * than by discipline.
 */
export default function WatchPane({ store, version, watches, breakpoints, onSeek, onRemove, onRemoveBp }) {
  if (!store) return null;
  if (watches.length === 0 && breakpoints.length === 0) return null;

  return (
    <>
      {watches.length > 0 && (
        <>
          <div className="section-head">
            Watches
            <span style={{ marginLeft: 'auto', textTransform: 'none' }}>{watches.length}</span>
          </div>
          <div className="watches">
            {watches.map((w) => (
              <Watch key={addrKey(w.s, w.at)} w={w} store={store} version={version}
                     onSeek={onSeek} onRemove={onRemove} />
            ))}
          </div>
        </>
      )}

      {breakpoints.length > 0 && (
        <>
          <div className="section-head">
            Breakpoints
            <span style={{ marginLeft: 'auto', textTransform: 'none' }}>{breakpoints.length}</span>
          </div>
          <div className="watches">
            {breakpoints.map((b) => (
              <div key={addrKey(b.s, b.at) + b.op} className="bp">
                <span className="mono">{addrLabel(b.s, b.at)}</span>
                <span className="op">{b.op}{b.value !== undefined ? ` ${fmtValue(b.value)}` : ''}</span>
                <button className="x" onClick={() => onRemoveBp(b)}
                        aria-label={`remove breakpoint on ${addrLabel(b.s, b.at)}`}>×</button>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function Watch({ w, store, version, onSeek, onRemove }) {
  const label = addrLabel(w.s, w.at);

  // Memoised on the trace, not on the step: the history of an address is a
  // property of the whole run and does not change as you move through it. The
  // only thing that moves is which entry you are standing on.
  const hist = useMemo(
    () => history(store.trace.events, store.steps, w.s, w.at),
    [store.trace, store.steps, w.s, w.at.join('/')], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const struct = store.struct(w.s);
  const live = struct ? struct.get(w.at) : undefined;
  const at = store.step;

  return (
    <div className="watch">
      <div className="watch-head">
        <span className="mono">{label}</span>
        <span className="now num">{struct ? fmtValue(live) : '—'}</span>
        <button className="x" onClick={() => onRemove(w)} aria-label={`stop watching ${label}`}>×</button>
      </div>
      {hist.length === 0 ? (
        <div className="pane-note" style={{ margin: 0 }}>never written</div>
      ) : (
        <div className="watch-hist">
          {hist.map((h, i) => (
            <button key={i} className="hentry" data-now={h.step === at ? 1 : 0}
                    onClick={() => onSeek(h.step)}
                    title={`seek to step ${h.step}`}>
              <span className="s">{h.step}</span>
              <span className="v num">{fmtValue(h.from)} → {fmtValue(h.to)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
