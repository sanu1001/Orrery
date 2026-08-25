// @ts-check
import OpenTraceButton from './OpenTraceButton.jsx';

/**
 * The first-run screen.
 *
 * Not a blank canvas that says "select an algorithm". It states the value
 * proposition in one sentence and then offers the four traces that best
 * demonstrate it, each labelled with what it will show you.
 */
const FEATURED = ['coins-memo', 'lcs', 'nqueens', 'binary'];

export default function EmptyState({ catalog, onPick, offline, onOpen }) {
  const byId = new Map((catalog ?? []).map((s) => [s.id, s]));
  const cards = FEATURED.map((id) => byId.get(id)).filter(Boolean);
  const rest = (catalog ?? []).filter((s) => !FEATURED.includes(s.id));

  return (
    <div className="empty">
      <div className="empty-inner">
        <h1>Orrery</h1>
        <p>
          Watch an algorithm run. Forwards, backwards, one step at a time —
          with the code, the data, and the reason.
        </p>

        {offline && (
          <p className="pane-note">
            Couldn&apos;t load the catalogue. Run <span className="mono">make traces</span> to
            generate it, then reload.
          </p>
        )}

        <div className="cards">
          {cards.map((s) => (
            <button key={s.id} className="card" onClick={() => onPick(s.id)}>
              <div className="t">{s.title}</div>
              <div className="m">{s.family.toLowerCase()}</div>
              <div className="m" style={{ marginTop: 8, fontFamily: 'inherit' }}>{s.blurb}</div>
            </button>
          ))}
        </div>

        {rest.length > 0 && (
          <p className="pane-note" style={{ marginTop: 24 }}>
            {rest.length} more in the picker above.
          </p>
        )}

        {/* Announced here rather than left to be discovered, because a trace
            file is only worth downloading if it is obvious it can come back. */}
        {onOpen && (
          <p className="pane-note">
            Or drop a <span className="mono">.orrery.json</span> anywhere on this
            page — <OpenTraceButton onOpen={onOpen} className="linkish">open a
            file</OpenTraceButton> works too.
          </p>
        )}
      </div>
    </div>
  );
}
