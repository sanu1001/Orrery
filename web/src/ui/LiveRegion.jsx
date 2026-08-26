// @ts-check
import { useMemo } from 'react';
import { explain } from '../lib/explain.js';
import { announce } from '../lib/announce.js';

/**
 * The app's single live region.
 *
 * ONE region, at the shell, rather than aria-live on each interesting pane.
 * Several live regions compete: a step that writes a cell, moves the call stack
 * and changes the code line would queue three announcements for one action, and
 * a screen reader reads them in an order nobody chose.
 *
 * It is visually hidden and holds the SPOKEN form of the step, not the visual
 * one. lib/announce.js explains the difference at length; the short version is
 * that `dp[5][5]: 0 → 3` speaks as "dp 5 5 0 3" once the arrow is dropped, so
 * the direction of the change reaches nobody who is listening.
 *
 * ExplainPane used to carry `aria-live="polite" aria-atomic="true"` on a
 * <section> whose first child is the heading "Explanation". Atomic means the
 * WHOLE region is re-read on every change, so every single step announced the
 * word "Explanation" before saying anything useful. That pane is now an
 * ordinary pane and this is the only thing that speaks.
 *
 * polite, never assertive: stepping is something the user just did, not an
 * emergency, and assertive would interrupt them mid-word every time they
 * pressed an arrow key.
 */
export default function LiveRegion({ store, version }) {
  const text = useMemo(() => {
    if (!store) return '';
    return announce(explain(store.currentEvents(), store.index), {
      step: store.step,
      total: store.stepCount,
    });
  }, [store, version]);

  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true" role="status">
      {text}
    </div>
  );
}
