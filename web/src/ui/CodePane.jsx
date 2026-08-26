// @ts-check
import { useEffect, useMemo, useRef, useState } from 'react';
import { foldableRanges, lineHits, peakHits } from '../lib/source.js';
import { tokenize } from '../lib/tokenize.js';
import { explain } from '../lib/explain.js';
import { fmtValue } from '../lib/value.js';

/**
 * The source, with the current line highlighted.
 *
 * This pane is the reason `ln` was added to the event spec. Without a per-event
 * line reference it could only display static text, and "the code, the data and
 * the explanation shown together" would silently become "the code, shown".
 * FLAWS.md 5.
 *
 * Three things here came out of the redesign, each of which was a measurement
 * rather than a preference:
 *
 *   - The prologue folds. About twelve of the first twenty-three lines are
 *     package, import and //go:embed plumbing, so the function you opened the
 *     pane to read started below the fold. 207 lines across the 17 built-ins.
 *   - The gutter shows how often a line ran. That count was already in
 *     `lineIndex` -- the pre-pass built it to make lines clickable -- and was
 *     only ever visible in a tooltip. Surfacing it turns the gutter into a
 *     cheap profile of where the work is.
 *   - The executing line carries the values it just wrote, so following a
 *     trace does not mean holding numbers in your head between panes.
 *
 * A jump target is a <button>, not a <div onClick>. It was the latter, which
 * meant the "click a line to jump to it" feature had no keyboard path at all --
 * invisible in review, and exactly the class of bug C11 exists to remove.
 */
export default function CodePane({ store, trace, version }) {
  const ref = useRef(/** @type {HTMLDivElement|null} */(null));
  const src = trace?.meta?.source;
  const lang = trace?.meta?.lang ?? 'go';
  const lines = useMemo(() => (src ? src.text.split('\n') : []), [src]);
  const cur = store ? store.currentLine() : 0;
  const lineIndex = store?.index?.lineIndex;
  const first = src?.firstLine || 1;

  const folds = useMemo(
    () => (src ? foldableRanges(src.text, lang, first) : []),
    [src, lang, first],
  );
  const [openFolds, setOpenFolds] = useState(/** @type {Record<number, boolean>} */({}));
  const peak = useMemo(() => peakHits(lineIndex), [lineIndex, version]);

  // Tokenised once per trace, never per step. The pane re-renders on every
  // step and the source never changes, so lexing inside the render loop would
  // be the same work several hundred times over.
  const toks = useMemo(() => (src ? tokenize(src.text, lang) : []), [src, lang]);

  // The values written by the current step, keyed for the line that wrote them.
  // Read from explain()'s structured fields rather than re-deriving: one source
  // of truth means the pane and the explanation can never disagree about what
  // this step did.
  const inline = useMemo(() => {
    if (!store) return [];
    const ex = explain(store.currentEvents(), store.index);
    // addrLabel's form, not announce's. The explanation pane sits beside this
    // one and writes memo[0][7]; speech helpers render the same address as
    // "memo 0 7" for a screen reader, and showing that here would put two
    // spellings of one address side by side on screen.
    return (ex.writes ?? []).map((w) => ({ label: w.label, value: fmtValue(w.to) }));
  }, [store, version]);

  const firstRef = useRef(true);
  useEffect(() => {
    if (!ref.current || !cur) return;
    // Follow on a deliberate single step, and once on load so a deep link opens
    // with the right line in view. NOT during a scrub: following the cursor
    // through hundreds of intermediate lines makes the pane shudder, which is
    // the same rule the renderers use. FRONTEND.md 7.
    const wasFirst = firstRef.current;
    firstRef.current = false;
    if (!wasFirst && !store?.animating) return;
    const el = ref.current.querySelector(`[data-ln="${cur}"]`);
    el?.scrollIntoView({ block: 'center', behavior: wasFirst ? 'auto' : 'smooth' });
  }, [cur, version, store]);

  if (!src) return null;

  const foldAt = (ln) => folds.find((f) => f.from === ln);
  const insideClosedFold = (ln) =>
    folds.some((f) => !openFolds[f.from] && ln > f.from && ln <= f.to);

  return (
    <>
      <div className="section-head">
        Code <span style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 }}>
          {src.path.split('/').pop()}
        </span>
      </div>
      <div className="codepane" ref={ref}>
        {lines.map((text, i) => {
          const ln = first + i;

          const fold = foldAt(ln);
          if (fold && !openFolds[fold.from]) {
            const n = fold.to - fold.from + 1;
            return (
              <button
                key={`fold-${ln}`}
                type="button"
                className="codefold"
                aria-expanded="false"
                onClick={() => setOpenFolds((o) => ({ ...o, [fold.from]: true }))}
              >
                {fold.label} — {n} lines hidden
              </button>
            );
          }
          if (insideClosedFold(ln)) return null;
          if (fold && openFolds[fold.from] && ln === fold.from) {
            // The pill stays reachable once expanded, or the only way back is
            // a reload.
            return (
              <button
                key={`fold-${ln}`}
                type="button"
                className="codefold open"
                aria-expanded="true"
                onClick={() => setOpenFolds((o) => ({ ...o, [fold.from]: false }))}
              >
                hide {fold.label}
              </button>
            );
          }

          const steps = lineIndex?.get(ln);
          const hits = lineHits(lineIndex, ln);
          const isCur = ln === cur;
          const heat = peak > 0 && hits > 0 ? Math.min(1, hits / peak) : 0;

          const body = (
            <>
              <span className="n" aria-hidden="true">{ln}</span>
              {hits > 0 && (
                // Heat is WEIGHT, not opacity. Opacity blends toward the
                // background, and this is already the dimmest text in the pane:
                // at the 0.35 floor it first had, the coldest counts measured
                // 3.6:1 against the pane, under WCAG AA. Dimming was also
                // redundant -- the number IS the magnitude, so fading it made
                // the small counts hard to read in order to say they were
                // small. Weight keeps every count at full contrast.
                <span className="hits" aria-hidden="true"
                      style={{ fontWeight: heat > 0.34 ? 600 : 400 }}>
                  {hits}
                </span>
              )}
              <span className="t">
                {/* A blank line still needs a space, or it collapses and the
                    gutter numbering drifts away from the source. */}
                {(toks[i] ?? []).length === 0
                  ? (text || ' ')
                  : toks[i].map((tk, k) => (
                      <span key={k} className={`tk-${tk.k}`}>{tk.t}</span>
                    ))}
              </span>
              {isCur && inline.length > 0 && (
                <span className="inlinevals" aria-hidden="true">
                  {inline.map((v, k) => (
                    <span key={k} className="iv">{v.label} = {v.value}</span>
                  ))}
                </span>
              )}
            </>
          );

          // Non-executing lines are not interactive, and must not be in the tab
          // order -- a source file is hundreds of lines and every one of them
          // as a tab stop would make the pane a keyboard trap in practice.
          if (!steps?.length) {
            return (
              <div key={ln} className="codeline" data-ln={ln} data-cur={isCur ? 1 : 0} data-hasstep={0}>
                {body}
              </div>
            );
          }
          return (
            <button
              key={ln}
              type="button"
              className="codeline"
              data-ln={ln}
              data-cur={isCur ? 1 : 0}
              data-hasstep={1}
              aria-current={isCur ? 'true' : undefined}
              aria-label={`Line ${ln}, runs ${hits} ${hits === 1 ? 'time' : 'times'}. Jump to first run.`}
              onClick={() => store.seek(steps[0] + 1)}
            >
              {body}
            </button>
          );
        })}
      </div>
    </>
  );
}
