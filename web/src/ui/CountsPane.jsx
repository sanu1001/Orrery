// @ts-check
import { useMemo } from 'react';

/**
 * Steps, events, calls and depth -- each against its total.
 *
 * The design is precise about what this panel is NOT: "no cost model, no
 * complexity claim, nothing that needs to know what is being measured". Every
 * figure here is a count of things in the trace, which is why one panel serves
 * a board search, a DP fill and a list reversal without a branch.
 *
 * Each is shown AGAINST ITS TOTAL because the totals are knowable before you
 * play: a complete trace means "242 of 256" is available at step 1. That is the
 * same property the scrubber's density track spends, and it is worth spending
 * twice -- it tells you how long the run is before you commit to watching it.
 */
export default function CountsPane({ store, version }) {
  const rows = useMemo(() => {
    if (!store) return [];
    const tree = store.index.callTree;
    const evIdx = store.eventIndex;
    // Calls so far is a scan over call NODES, not over events: the pre-pass
    // already collapsed the call tree, and each node carries the event that
    // opened it.
    let calls = 0;
    for (const n of tree.nodes) if (n.id < evIdx) calls++;
    return [
      { label: 'steps', value: store.step, sub: `of ${store.stepCount}` },
      { label: 'events', value: evIdx, sub: `of ${store.trace.events.length}` },
      { label: 'calls', value: calls, sub: `of ${tree.nodes.length}` },
      { label: 'depth', value: store.callStack().length, sub: `max ${tree.maxDepth}` },
    ];
  }, [store, version]);

  if (!store) return null;

  return (
    <>
      <div className="section-head">Counts</div>
      <dl className="counts">
        {rows.map((r) => (
          <div key={r.label} className="count">
            {/* dt/dd rather than two divs: a screen reader then reads "steps,
                242 of 256" as one term and its value, instead of eight
                unrelated numbers in a row. */}
            <dt>{r.label}</dt>
            <dd>
              <span className="count-v">{r.value}</span>
              <span className="count-sub">{r.sub}</span>
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}
