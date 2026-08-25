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
export default function WatchPane({ store, version, watches, breakpoints, target, liveBps,
                                    onSeek, onRemove, onRemoveBp, onWatch, onBreak }) {
  // Always rendered once a trace is loaded, even with nothing selected. A rail
  // that only appears after you have already used it cannot teach you that it
  // exists, and this is the one feature with no other affordance on screen.
  if (!store) return null;

  const key = target ? addrKey(target.s, target.at) : '';
  const watched = watches.some((w) => addrKey(w.s, w.at) === key);
  const broken = breakpoints.some((b) => addrKey(b.s, b.at) === key);

  return (
    <>
      {/* The selected address, stated rather than implied.
          Watches and breakpoints act on whatever is selected, so when nothing
          is this row says so -- the first version had no such row, the keys
          silently did nothing when focus was empty, and that is indistinguishable
          from the feature being broken. */}
      <div className="section-head">
        Debug
        <span style={{ marginLeft: 'auto', textTransform: 'none' }}>
          {target ? addrLabel(target.s, target.at) : 'click a cell to select'}
        </span>
      </div>
      {target && (
        <div className="dbg-actions">
          <button onClick={onWatch} aria-pressed={watched}>
            {watched ? 'unwatch' : 'watch'}
          </button>
          <button onClick={onBreak} aria-pressed={broken}>
            {broken ? 'clear breakpoint' : 'breakpoint'}
          </button>
          <span className="pane-note" style={{ margin: 0, marginLeft: 'auto' }}>w · b</span>
        </div>
      )}

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
              <div key={addrKey(b.s, b.at) + b.op} className="bp"
                   data-dead={liveBps && !liveBps.has(addrKey(b.s, b.at)) ? 1 : 0}>
                <span className="mono">{addrLabel(b.s, b.at)}</span>
                <span className="op">{b.op}{b.value !== undefined ? ` ${fmtValue(b.value)}` : ''}</span>
                {liveBps && !liveBps.has(addrKey(b.s, b.at)) && (
                  <span className="dead" title="nothing in this trace writes that address">never fires</span>
                )}
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
