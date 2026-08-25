// @ts-check
/**
 * The entire "plain English" system.
 *
 * One generic template, no per-algorithm code (invariant I2), no language
 * model. Everything it needs is already in the event: `expr` says how the value
 * was computed, `deps` says what was read AND what those cells held at read
 * time.
 *
 * Those dep values are SNAPSHOTTED into the event rather than looked up during
 * replay. That is what makes the explanation exact while stepping BACKWARD:
 * current state during a rewind is not the state the read saw. ADR 0005.
 *
 * The Go twin lives in cmd/orrery/explain.go and drives the terminal player.
 * Two consumers, one set of rules, zero algorithm-specific text anywhere.
 */

import { addrLabel, fmtValue } from './value.js';

/**
 * @typedef {object} Explanation
 * @property {'set'|'call'|'ret'|'init'|'none'} kind
 * @property {string} lead
 * @property {string} because
 * @property {Array<{label:string, value:string, s:string, at:Array}>} where
 * @property {number} ln
 */

/**
 * @param {Array<object>} events the events of the current step
 * @param {import('../player/prepass.js').Index} [index]
 * @returns {Explanation}
 */
export function explain(events, index) {
  const empty = { kind: /** @type {const} */ ('none'), lead: '', because: '', where: [], ln: 0 };
  if (!events || events.length === 0) return empty;

  // A grouped step (a swap) has several events. Lead with the group's note and
  // merge the provenance -- describing only the first write would be a lie
  // about what the step did.
  const primary = events.find((e) => e.t === 'set') ?? events[0];
  const note = events.find((e) => e.note)?.note ?? '';

  const where = [];
  for (const e of events) {
    for (const d of e.deps ?? []) {
      where.push({
        label: addrLabel(d.s, d.at ?? []),
        value: fmtValue(d.v),
        s: d.s,
        at: d.at ?? [],
      });
    }
  }

  switch (primary.t) {
    case 'init':
      return { ...empty, kind: 'init', lead: `${primary.s} created`, ln: primary.ln ?? 0 };

    case 'call': {
      const args = (primary.args ?? []).map((a) => `${a.n}=${fmtValue(a.v)}`).join(', ');
      return {
        kind: 'call', lead: `${primary.fn}(${args})`,
        because: note, where, ln: primary.ln ?? 0,
      };
    }

    case 'ret': {
      let because = note || primary.expr || '';
      // "already computed at step N" comes from the pre-pass firstWrite index,
      // not from the event -- the trace records what was read, and the app
      // figures out when it was written.
      const d = (primary.deps ?? [])[0];
      if (index && d) {
        const ev = index.firstWrite.get(`${d.s} ${(d.at ?? []).join('/')}`);
        if (ev !== undefined) {
          const k = index.steps.findIndex((s) => ev >= s.e0 && ev < s.e1);
          if (k >= 0) because = because ? `${because} — computed at step ${k + 1}` : `computed at step ${k + 1}`;
        }
      }
      return {
        kind: 'ret', lead: `returns ${fmtValue(primary.v)}`,
        because, where, ln: primary.ln ?? 0,
      };
    }

    case 'set': {
      const writes = events.filter((e) => e.t === 'set');
      let lead;
      if (writes.length > 1) {
        lead = writes.map((e) => `${addrLabel(e.s, e.at ?? [])} → ${fmtValue(e.to)}`).join('  ·  ');
      } else {
        const a = addrLabel(primary.s, primary.at ?? []);
        lead = primary.from === null || primary.from === undefined
          ? `${a} ← ${fmtValue(primary.to)}`
          : `${a}: ${fmtValue(primary.from)} → ${fmtValue(primary.to)}`;
      }
      return {
        kind: 'set', lead,
        because: note || primary.expr || '',
        where, ln: primary.ln ?? 0,
      };
    }
  }
  return empty;
}
