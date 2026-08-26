// @ts-check
import { explain } from '../lib/explain.js';

/**
 * The explanation pane: the VISUAL form of a step.
 *
 * It used to claim that aria-live="polite" was "the whole accessibility story
 * in one attribute". It was not, in two ways, and both were invisible on screen.
 *
 * The attribute sat on a <section> whose first child is the heading, with
 * aria-atomic, so every step re-announced the word "Explanation" before saying
 * anything useful. And what it announced was this pane's text, which spends
 * glyphs to stay compact: dp[5][5]: 0 -> 3 speaks as "dp 5 5 0 3" once a screen
 * reader drops the arrow, leaving the direction of the change carried entirely
 * by a character that is never read aloud.
 *
 * Speaking moved to ui/LiveRegion.jsx, one region for the whole app, filled
 * from lib/announce.js. This is now just a pane.
 */
export default function ExplainPane({ store, version }) {
  const ex = store ? explain(store.currentEvents(), store.index) : null;
  return (
    <section className="explain">
      <div className="section-head" style={{ border: 0, padding: 0, marginBottom: 8 }}>
        Explanation
      </div>
      {!ex || ex.kind === 'none' ? (
        <div className="idle">
          {/* The glyphs are for the eye. Read aloud, "Press or to take the
              first step" is not an instruction, so each one carries a spoken
              equivalent beside it. */}
          Press <b aria-hidden="true">▶</b><span className="sr-only">play</span>
          {' '}or <b aria-hidden="true">→</b><span className="sr-only">the right arrow key</span>
          {' '}to take the first step.
        </div>
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
