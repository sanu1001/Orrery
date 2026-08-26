// @ts-check
import { useMemo } from 'react';
import { addrKey, addrLabel, fmtValue } from '../lib/value.js';
import { familyOf, familyLabel, cellState } from '../lib/family.js';
import { explain } from '../lib/explain.js';

/**
 * The siblings of the address this step wrote.
 *
 * The first redesign asked for "Rows tried in column 3" and the second found
 * the general statement behind it: wildcard one index of the written address
 * and show what sits beside it. For N-Queens that is the row of squares tried
 * in this column, for a DP table the fill front of the current row, for a list
 * every `.next` pointer and which way each now points -- and this file knows
 * about none of those. It asks lib/family.js for the siblings and asks the
 * player for each one's state.
 *
 * Every state carries a GLYPH and a BORDER STYLE as well as a hue. Colour is
 * never the only channel: WCAG 1.4.1, and also the plain reality that these
 * five hues have to survive being read on a projector.
 *
 * The panel keeps its slot when there is nothing to show, and says so in its
 * own words. A rail that reflows the moment a run starts makes the reader
 * re-find every panel, and the empty state is the only chance to label things
 * before they start moving.
 */
export default function FamilyPane({ store, version }) {
  const focus = useMemo(() => focusAddress(store), [store, version]);

  const fam = useMemo(() => {
    if (!store || !focus) return null;
    return familyOf(focus.s, focus.at, store.index.structUnion);
  }, [store, focus, version]);

  const rows = useMemo(() => {
    if (!store || !fam || !focus) return [];
    const ex = explain(store.currentEvents(), store.index);
    const written = new Set((ex.writes ?? []).map((w) => addrKey(w.s, w.at)));
    const read = new Set((ex.where ?? []).map((r) => addrKey(r.s, r.at)));
    const union = store.index.structUnion.get(focus.s);
    const fill = union ? union.fill : null;
    const last = lastWrites(store, focus.s, fam.members);

    return fam.members.map((at) => {
      const key = addrKey(focus.s, at);
      const v = store.state.get(focus.s, at);

      // State comes from the last WRITE at or before now, never from the
      // current value; lib/family.js says why, and it cost two bugs to learn.
      //
      // Which addresses are pointers is DECLARED by the producer, in
      // `schema.fields` and `schema.refs` -- data arriving in the trace, the
      // same category as meta.views, so reading it is not this pane knowing
      // what a linked list is.
      const state = cellState({
        write: last.get(key),
        fill,
        pointer: isPointer(union, at),
        writtenNow: written.has(key),
        readNow: read.has(key),
      });

      return {
        key, at, state,
        index: at[fam.axis],
        value: v === null || v === undefined ? '' : fmtValue(v),
        label: addrLabel(focus.s, at),
      };
    });
  }, [store, fam, focus, version]);

  if (!store) return null;

  const heading = fam && focus ? familyLabel(focus.s, focus.at, fam.axis) : '';
  const written = rows.filter((r) => r.state === 'written' || r.state === 'settled' || r.state === 'undone').length;
  const undone = rows.filter((r) => r.state === 'undone').length;

  return (
    <>
      <div className="section-head">
        Nearby
        <span style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 }}>
          {heading}
        </span>
      </div>

      {rows.length === 0 ? (
        // Its own words, not a shared "nothing here". What is absent differs:
        // before a run nothing has been written; a scalar cursor has no
        // siblings at all and never will.
        <div className="fam-empty">
          {focus
            ? 'this address has no siblings to compare it against'
            : 'no address written yet — this panel fills with the neighbours of the first write'}
        </div>
      ) : (
        <>
          <ul className="fam" aria-label={`siblings of ${heading}`}>
            {rows.map((r) => (
              <li key={r.key} className="fam-cell" data-state={r.state}
                  aria-label={`${r.label}, ${WORD[r.state]}${r.value ? `, ${r.value}` : ''}`}>
                <span className="fam-glyph" aria-hidden="true">{GLYPH[r.state]}</span>
                <span className="fam-idx" aria-hidden="true">{String(r.index)}</span>
                <span className="fam-val" aria-hidden="true">{r.value}</span>
                {/* The state in words as well as in glyph and hue. A reader
                    should not have to learn the key to read the panel, and
                    this is the panel the key is most often needed for. */}
                {r.state !== 'empty' && (
                  <span className="fam-word" aria-hidden="true">{SHORT[r.state]}</span>
                )}
              </li>
            ))}
          </ul>
          <div className="fam-note">
            {rows.length} sibling{rows.length === 1 ? '' : 's'} · {written} written
            {undone > 0 ? ` · ${undone} undone` : ''}
          </div>
        </>
      )}
    </>
  );
}

/**
 * Glyph and border style carry every state independently of hue, so the panel
 * reads with colour removed entirely. The strikethrough on `undone` is a third
 * channel, because "was written and then taken back" is the state a reader is
 * most likely to misread as "never written".
 */
const GLYPH = { written: 'w', read: 'r', undone: '✗', settled: '✓', empty: '·' };
/* Short for the eye, long for the ear. The cell shows "undone"; the accessible
   name says "written then undone", because a screen reader user has no column
   header or colour to disambiguate it against. */
const SHORT = { written: 'written', read: 'read', undone: 'undone', settled: 'settled', empty: '' };
const WORD = {
  written: 'written this step',
  read: 'read this step',
  undone: 'written then undone',
  settled: 'settled',
  empty: 'untouched',
};

/**
 * Whether an address holds a pointer, according to what the producer declared.
 * A `$refs` entry is one by definition; a node field is one when the structure's
 * schema says `ptr`.
 */
function isPointer(union, at) {
  if (!at || at.length === 0) return false;
  if (at[0] === '$refs') return true;
  const fields = union?.schema?.fields;
  return !!fields && fields[at[at.length - 1]] === 'ptr';
}

/**
 * The most recent write to each family member at or before the current step.
 *
 * ONE backward pass over the events, not one scan per member: a family is up to
 * a few dozen cells and the scrubber seeks on every input event without
 * throttling, so per-member scanning would turn a drag into quadratic work. The
 * pass stops as soon as every member is accounted for, which on a dense
 * structure is a few steps back.
 *
 * @returns {Map<string, {from:*, to:*}>}
 */
function lastWrites(store, s, members) {
  const wanted = new Set(members.map((at) => addrKey(s, at)));
  const out = new Map();
  const events = store.trace?.events ?? [];
  for (let i = Math.min(store.eventIndex, events.length) - 1; i >= 0; i--) {
    if (out.size === wanted.size) break;
    const e = events[i];
    if (e.t !== 'set' || e.s !== s) continue;
    const k = addrKey(e.s, e.at ?? []);
    if (!wanted.has(k) || out.has(k)) continue;
    out.set(k, { from: e.from, to: e.to });
  }
  return out;
}

/**
 * The address the panel is about.
 *
 * Current step's write when there is one; otherwise the most recent write
 * before it, so a run of reads or returns does not blank a panel that was just
 * telling you something. Before the first step, the first write in the trace --
 * which is what lets the empty rail show the shape the run will fill.
 *
 * Scanning back through events is the same argument breakpoints make: the trace
 * is complete and in memory, so "the last write before here" is a scan, not a
 * replay, and costs the same backwards as forwards.
 */
function focusAddress(store) {
  if (!store) return null;
  const ex = explain(store.currentEvents(), store.index);
  const w = (ex.writes ?? [])[0];
  if (w) return { s: w.s, at: w.at };

  const events = store.trace?.events ?? [];
  const here = store.eventIndex ?? events.length;
  for (let i = Math.min(here, events.length) - 1; i >= 0; i--) {
    if (events[i].t === 'set') return { s: events[i].s, at: events[i].at ?? [] };
  }
  for (let i = 0; i < events.length; i++) {
    if (events[i].t === 'set') return { s: events[i].s, at: events[i].at ?? [] };
  }
  return null;
}
