// @ts-check
/**
 * Event density along the scrubber.
 *
 * The redesign's observation: a scrubber that shows only POSITION wastes the
 * one thing a complete trace makes possible. The whole run is known before the
 * first frame is drawn, so the track can show the SHAPE of the search -- where
 * the work clusters, where it gave up -- before you play it.
 *
 * It asked for "tall indigo ticks are placements, short warm ticks are
 * rejections and backtracks". Indigo is not available here: UI_DESIGN.md gives
 * every colour exactly one meaning and forbids an accent for chrome, and the
 * explanations name those colours in words. But the distinction the design
 * wanted already exists in the palette, and states it more precisely than a new
 * hue would have -- amber already means "written this step", rose already means
 * "failed branch, backtracked". The ticks reuse those.
 *
 * The classification is generic, never per-algorithm (I2). A write whose new
 * value equals its structure's `fill` is a cell going back to empty, which is
 * what taking a queen back, freeing a slot and clearing a visited mark all look
 * like in the trace. Nothing here knows what N-Queens is.
 */

/**
 * @typedef {object} Tick
 * @property {'write'|'revert'|'call'|'ret'} kind
 * @property {number} weight events in this step; 1 for an ordinary single write
 */

/**
 * @param {object} trace
 * @param {{steps: Array<{e0:number, e1:number}>}} index
 * @returns {Tick[]} one entry per step, in order
 */
export function stepDensity(trace, index) {
  if (!trace || !trace.events || !index || !index.steps) return [];

  // `fill` is what "empty" means for each structure, and it is declared by the
  // producer on init rather than assumed to be 0 or null. A DP table filled
  // with a large sentinel would otherwise read as permanently reverted.
  const fill = new Map();
  for (const e of trace.events) if (e.t === 'init') fill.set(e.s, e.fill === undefined ? null : e.fill);

  return index.steps.map((s) => {
    let writes = 0, reverts = 0, calls = 0, rets = 0;
    for (let i = s.e0; i < s.e1; i++) {
      const e = trace.events[i];
      if (!e) continue;
      if (e.t === 'set') {
        // A revert is a transition AWAY from a written value, not merely a
        // write whose value equals the fill. The first rule here was
        // `to === fill`, and LCS caught it: row 1 of an alignment table
        // legitimately computes 0 into a cell that already holds 0, and four
        // steps of a monotone DP fill reported as backtracking. `from` is what
        // separates "cleared" from "computed a value that happens to be empty".
        const f = fill.get(e.s);
        if (same(e.to, f) && !same(e.from, f)) reverts++;
        else writes++;
      } else if (e.t === 'call') calls++;
      else if (e.t === 'ret') rets++;
    }
    const weight = Math.max(1, s.e1 - s.e0);
    // A grouped step that both reverts and writes (a swap through a temp) reads
    // as a write: something advanced. Reverting is only the story when it is
    // the only story.
    if (writes > 0) return { kind: 'write', weight };
    if (reverts > 0) return { kind: 'revert', weight };
    if (calls > 0) return { kind: 'call', weight };
    return { kind: 'ret', weight };
  });
}

/**
 * Trace values arrive normalised, so `===` is right for every scalar the format
 * allows. Arrays appear only as whole-structure fills, where identity is not
 * what "back to empty" means, so they deliberately never match.
 */
function same(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  return a === b;
}

/**
 * The busiest step, for scaling tick height. Measured rather than fixed: a
 * 121-step backtracking trace and a 43-step DP fill differ by an order of
 * magnitude, and a fixed scale flattens one of them into a wall.
 * @param {Tick[]} ticks
 */
export function peakWeight(ticks) {
  let max = 0;
  for (const t of ticks) if (t.weight > max) max = t.weight;
  return max || 1;
}
