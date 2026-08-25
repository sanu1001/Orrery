// @ts-check
import { useEffect, useMemo, useRef } from 'react';

/**
 * The source, with the current line highlighted.
 *
 * This pane is the reason `ln` was added to the event spec. Without a per-event
 * line reference it could only display static text, and "the code, the data and
 * the explanation shown together" would silently become "the code, shown".
 * FLAWS.md 5.
 *
 * Lines that have at least one step attached are clickable: the pre-pass built
 * a line -> steps index, so jumping to "where does this line first run" is a
 * map lookup rather than a scan.
 */
export default function CodePane({ store, trace, version }) {
  const ref = useRef(/** @type {HTMLDivElement|null} */(null));
  const src = trace?.meta?.source;
  const lines = useMemo(() => (src ? src.text.split('\n') : []), [src]);
  const cur = store ? store.currentLine() : 0;
  const lineIndex = store?.index?.lineIndex;

  // Follow the current line ONLY on a deliberate single step. During a scrub
  // this would make the pane shudder, which is the same rule the renderers use
  // for cursor-follow. FRONTEND.md 7.
  const firstRef = useRef(true);
  useEffect(() => {
    if (!ref.current || !cur) return;
    // Follow on a deliberate single step, and once on load so a deep link opens
    // with the right line in view. NOT during a scrub: following the cursor
    // through hundreds of intermediate lines makes the pane shudder, which is
    // the same rule the renderers use. FRONTEND.md 7.
    const first = firstRef.current;
    firstRef.current = false;
    if (!first && !store?.animating) return;
    const el = ref.current.querySelector(`[data-ln="${cur}"]`);
    el?.scrollIntoView({ block: 'center', behavior: first ? 'auto' : 'smooth' });
  }, [cur, version, store]);

  if (!src) return null;
  const first = src.firstLine || 1;

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
          const steps = lineIndex?.get(ln);
          return (
            <div key={ln} className="codeline" data-ln={ln}
                 data-cur={ln === cur ? 1 : 0}
                 data-hasstep={steps ? 1 : 0}
                 title={steps ? `${steps.length} step(s) run this line — click to jump` : undefined}
                 onClick={() => { if (steps?.length) store.seek(steps[0] + 1); }}>
              <span className="n">{ln}</span>
              <span className="t">{text || ' '}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
