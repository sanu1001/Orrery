// @ts-check
/**
 * Step indexing. Mirrors internal/trace/steps.go.
 *
 * A STEP is what one press of the play button advances. An EVENT is one write.
 * They are not 1:1, and conflating them is the most common bug in this design:
 * adjacent events sharing a non-zero group id form ONE step, so a swap is two
 * writes and one step.
 *
 * Step boundaries are a property of the TRACE, not of the consumer. If the two
 * players disagreed about them, deep links and the step counter would mean
 * different things in each -- which is why this lives here rather than in a
 * renderer.
 */

/**
 * @typedef {{e0:number, e1:number, ln:number}} Step
 */

/**
 * @param {Array<object>} events
 * @param {number} level keep events with lvl <= level
 * @returns {Step[]}
 */
export function buildSteps(events, level) {
  const steps = [];
  let i = 0;
  while (i < events.length) {
    if ((events[i].lvl ?? 0) > level) {
      i++;
      continue;
    }
    const g = events[i].g ?? 0;
    let j = i + 1;
    if (g !== 0) {
      while (j < events.length && (events[j].g ?? 0) === g) j++;
    }
    steps.push({ e0: i, e1: j, ln: events[i].ln ?? 0 });
    i = j;
  }
  return steps;
}

/**
 * The step containing event index ev, or -1.
 * @param {Step[]} steps @param {number} ev
 */
export function stepIndexOf(steps, ev) {
  let lo = 0, hi = steps.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ev < steps[mid].e0) hi = mid - 1;
    else if (ev >= steps[mid].e1) lo = mid + 1;
    else return mid;
  }
  return -1;
}
