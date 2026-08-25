// @ts-check
/**
 * Play, step, scrub, speed, detail level.
 *
 * The scrubber calls store.seek() directly on every input event -- no
 * throttling. That is only possible because seeking is O(distance) over a
 * mutable state (ADR 0002, ADR 0010); with immutable updates this control would
 * have to be throttled and would feel laggy, which is exactly the property the
 * architecture promised would be instant.
 */
export default function Transport({ store, version }) {
  if (!store) return <div className="transport" />;
  const at = store.step;
  const n = store.stepCount;
  const playing = store.isPlaying();

  return (
    <div className="transport" role="toolbar" aria-label="playback">
      <div className="btns">
        <button onClick={() => store.seek(0)} disabled={at === 0}
                title="first step (Home)" aria-label="first step">⏮</button>
        <button onClick={() => store.prev()} disabled={at === 0}
                title="previous step (←)" aria-label="previous step">◀</button>
        <button className="play" onClick={() => store.toggle()}
                title={playing ? 'pause (space)' : 'play (space)'}
                aria-label={playing ? 'pause' : 'play'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <button onClick={() => store.next()} disabled={at >= n}
                title="next step (→)" aria-label="next step">▶|</button>
        <button onClick={() => store.seek(n)} disabled={at >= n}
                title="last step (End)" aria-label="last step">⏭</button>
      </div>

      <span className="counter">step {at} / {n}</span>

      <input className="scrub" type="range" min={0} max={n} value={at}
             aria-label="scrub through the trace"
             onChange={(e) => store.seek(Number(e.target.value))} />

      <div className="seg" role="group" aria-label="speed">
        {[1, 2, 4, 8].map((s) => (
          <button key={s} aria-pressed={store.speed === s}
                  onClick={() => store.setSpeed(s)}>{s}×</button>
        ))}
      </div>

      {/* Some traces open past a CONSTRUCTION PROLOGUE -- the writes that build
          the input tree or list before the algorithm starts. Watching it is
          clarifying once and tedious every time after, so the player starts
          past it and this is the way back in. The prologue steps are ordinary
          steps: rewinding into them is stepping, not a special mode.
          RENDERERS/TREE.md 2.3. */}
      {store.startStep > 0 && (
        <button className="prologue" aria-pressed={at < store.startStep}
                onClick={() => store.seek(at < store.startStep ? store.startStep : 0)}
                title={at < store.startStep
                  ? 'jump past the steps that build the input'
                  : 'rewind to watch the input being built'}>
          {at < store.startStep ? 'skip construction' : 'show construction'}
        </button>
      )}

      {/* Detail levels are one trace, filtered -- not two traces that drift.
          Sound only because lvl>0 is restricted to aux structures. ADR 0016. */}
      <div className="seg" role="group" aria-label="detail level" title="detail (d)">
        {[0, 1].map((l) => (
          <button key={l} aria-pressed={store.level === l}
                  onClick={() => store.setLevel(l)}>
            {l === 0 ? 'writes' : 'detail'}
          </button>
        ))}
      </div>
    </div>
  );
}
