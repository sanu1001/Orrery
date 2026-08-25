// @ts-check
import { addrKey, deepEqual, INF } from '../lib/value.js';

/**
 * A debugger over a finished trace: breakpoints and watch history.
 *
 * THE THING THAT MAKES THIS SIXTY LINES RATHER THAN SIX HUNDRED.
 *
 * Matching a breakpoint is a scan over EVENTS, never a replay. Every `set`
 * carries its full `to` value rather than a delta (I1), so the value an address
 * holds after any write is sitting in the event itself. "Stop when dp[5][5] > 3"
 * is therefore "the first `set` on that address whose `to` exceeds 3" -- there
 * is no state to reconstruct, and reconstructing none is what makes searching
 * BACKWARD cost exactly what searching forward costs.
 *
 * That is the reversibility invariant paying for itself a second time. The
 * first was free rewind; this is the same property spent on a different feature,
 * which is the argument for having made the format reversible at all. ADR 0002.
 *
 * Nothing here touches the DOM, the store, or React, so it is tested in Node.
 *
 * @typedef {{s: string, at: Array<number|string>, op: string, value?: *}} Breakpoint
 * @typedef {import('./steps.js').Step} Step
 */

/**
 * `writes` and `changes` are BOTH offered, and the difference is not pedantic.
 *
 * A DP table carries values forward: `dp[1][1] = max(dp[0][1], dp[1][0])` with
 * both neighbours 0 writes a 0 over a 0. That is a real event the algorithm
 * really performed, so someone asking "when is this cell computed" wants
 * `writes`; someone asking "when does this answer move" wants `changes`. Only
 * offering `changes` makes a breakpoint on a DP cell silently never fire, which
 * reads as the feature being broken rather than as a precise answer.
 */
export const OPS = ['writes', 'changes', '==', '!=', '<', '<=', '>', '>='];

/**
 * Numeric coercion for the ordering ops.
 *
 * `inf` is a string on the wire because JSON has no Infinity, and a Dijkstra
 * table is full of it -- so `dist > 5` has to answer honestly about a cell
 * holding "inf" rather than silently comparing a string to a number. Anything
 * genuinely non-numeric returns NaN, and every comparison against NaN is false:
 * an ordering breakpoint on a structure of refs simply never fires, which is
 * the right answer rather than an arbitrary one.
 *
 * @param {*} v @returns {number}
 */
function num(v) {
  if (typeof v === 'number') return v;
  if (v === INF) return Infinity;
  if (v === '-inf') return -Infinity;
  return NaN;
}

/**
 * Does one `set` event satisfy one breakpoint?
 *
 * @param {Breakpoint} bp @param {*} ev
 */
export function hits(bp, ev) {
  if (!ev || ev.t !== 'set' || ev.s !== bp.s) return false;
  if (addrKey(ev.s, ev.at ?? []) !== addrKey(bp.s, bp.at ?? [])) return false;

  switch (bp.op) {
    case 'writes': return true;
    case 'changes': return !deepEqual(ev.from, ev.to);
    case '==': return deepEqual(ev.to, bp.value);
    case '!=': return !deepEqual(ev.to, bp.value);
    case '<': return num(ev.to) < num(bp.value);
    case '<=': return num(ev.to) <= num(bp.value);
    case '>': return num(ev.to) > num(bp.value);
    case '>=': return num(ev.to) >= num(bp.value);
    default: return false;
  }
}

/**
 * The next step at or beyond which some breakpoint fires, or -1.
 *
 * `atStep` is the player's position: steps[0..atStep-1] have been applied, so
 * the events currently on screen are steps[atStep - 1]. A match inside
 * steps[j] therefore has to land the player on step j + 1, because that is the
 * position from which the write is visible.
 *
 * Both directions EXCLUDE the step already showing. Without that, continuing
 * from a step that is itself a match returns that same step forever and the
 * button looks dead.
 *
 * A grouped step is reported once no matter how many of its events match: a
 * swap is two writes and one step, and stopping "twice" on one step is
 * meaningless. ADR 0020.
 *
 * @param {Array<object>} events
 * @param {Step[]} steps
 * @param {Breakpoint[]} bps
 * @param {number} atStep
 * @param {number} dir  +1 forward, -1 backward
 * @returns {number} a step to seek to, or -1
 */
export function matchFrom(events, steps, bps, atStep, dir = 1) {
  if (!bps || bps.length === 0) return -1;

  const matchesStep = (j) => {
    const st = steps[j];
    for (let i = st.e0; i < st.e1; i++) {
      for (const bp of bps) if (hits(bp, events[i])) return true;
    }
    return false;
  };

  if (dir > 0) {
    for (let j = atStep; j < steps.length; j++) {
      if (matchesStep(j)) return j + 1;
    }
    return -1;
  }
  // Backward starts two behind: steps[atStep - 1] is what is showing.
  for (let j = atStep - 2; j >= 0; j--) {
    if (matchesStep(j)) return j + 1;
  }
  return -1;
}

/**
 * Every write to one address, in step order.
 *
 * Scanned on demand and memoised by the caller rather than indexed in the
 * pre-pass. A pre-pass entry would cost memory proportional to the whole trace
 * for a feature most sessions never use, and `prepass.js` is deliberately kept
 * off the interaction path. A watch is created by a human pressing a key; one
 * linear scan at that moment is invisible, and the largest built-in trace is
 * 445 events.
 *
 * @param {Array<object>} events
 * @param {Step[]} steps
 * @param {string} s
 * @param {Array<number|string>} at
 * @returns {Array<{step: number, from: *, to: *}>}
 */
export function history(events, steps, s, at) {
  const key = addrKey(s, at ?? []);
  const out = [];
  for (let j = 0; j < steps.length; j++) {
    const st = steps[j];
    for (let i = st.e0; i < st.e1; i++) {
      const ev = events[i];
      if (ev.t !== 'set' || addrKey(ev.s, ev.at ?? []) !== key) continue;
      // step j + 1 for the same reason matchFrom returns j + 1: that is where
      // the player has to stand for this write to be on screen.
      out.push({ step: j + 1, from: ev.from, to: ev.to });
    }
  }
  return out;
}
