// @ts-check
import { explain } from '../lib/explain.js';

/**
 * The explanation pane.
 *
 * aria-live="polite" is the whole accessibility story in one attribute: this
 * pane is already a complete textual description of every step, so a screen
 * reader user can follow LCS end to end. Almost no algorithm visualizer is
 * usable without sight, and here it costs one attribute because the trace
 * already carries the provenance. FRONTEND.md 10.
 */
export default function ExplainPane({ store, version }) {
  const ex = store ? explain(store.currentEvents(), store.index) : null;
  return (
    <section className="explain" aria-live="polite" aria-atomic="true">
      <div className="section-head" style={{ border: 0, padding: 0, marginBottom: 8 }}>
        Explanation
      </div>
      {!ex || ex.kind === 'none' ? (
        <div className="idle">Press <b>▶</b> or <b>→</b> to take the first step.</div>
      ) : (
        <>
          <div className="lead num">{ex.lead}</div>
          {ex.because && (
            <div className="because">
              because <span className="expr">{ex.because}</span>
            </div>
          )}
          {ex.where.length > 0 && (
            <div className="where">
              where {ex.where.map((w, i) => (
                <span key={i}>
                  {i > 0 && ', '}
                  <b>{w.label}</b> was {w.value}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
