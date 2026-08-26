// @ts-check
/**
 * The spoken form of a step.
 *
 * `lib/explain.js` produces the text the eye reads. This produces the sentence
 * an aria-live region hands to a screen reader. They are not the same string,
 * and the difference is the entire point of C11.
 *
 * The visual form spends glyphs to stay compact: `dp[5][5]: 0 → 3`. At default
 * punctuation settings a screen reader drops the arrow, so that speaks as
 * "dp 5 5 0 3" -- the direction of the change carried by a character that was
 * never announced, leaving the listener unable to tell the old value from the
 * new one. Same for the `←` of a first write, the `·` between grouped writes,
 * and the `∞` of an unreachable cell.
 *
 * So this module states direction in words, expands every glyph the codebase
 * uses, and leads with the step position -- a sighted user reads "7 / 43" off
 * the transport, and without it a listener has no equivalent of the scrubber.
 *
 * It is built from `Explanation`'s structured fields, never by rewriting
 * `lead`. String surgery on the visual form would drift the moment either side
 * changed, and the failure mode is silent: sighted and blind users told
 * different things about the same step.
 */

import { INF } from './value.js';

/**
 * Glyphs this codebase uses in prose that a screen reader either skips or
 * renders as a symbol name. Applied to author-written text (`note`, `expr`)
 * where they can appear; the structural arrows never reach here at all,
 * because direction is rebuilt in words instead.
 */
const GLYPHS = [
  [/→/g, ' becomes '],   // →
  [/←/g, ' is set to '], // ←
  [/∞/g, 'infinity'],    // ∞
  [/·/g, ', '],          // ·
  [/≤/g, ' at most '],   // ≤
  [/≥/g, ' at least '],  // ≥
  [/≠/g, ' is not '],    // ≠
  [/—/g, ', '],          // — em dash: a pause, not a word
  [/--/g, ', '],
];

/** @param {string} s */
function desugar(s) {
  let out = String(s ?? '');
  for (const [re, word] of GLYPHS) out = out.replace(/** @type {RegExp} */(re), /** @type {string} */(word));
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Speak an address. `dp[5][5]` reads as "dp 5 5" rather than "dp left bracket
 * 5 right bracket": brackets add four spoken words per address and carry no
 * information a listener needs, and these are announced on every single step.
 * @param {string} name @param {Array<number|string>} at
 */
export function speakAddr(name, at) {
  if (!at || at.length === 0) return name;
  return [name, ...at.map(String)].join(' ');
}

/** @param {*} v */
export function speakValue(v) {
  if (v === INF) return 'infinity';
  if (v === null || v === undefined) return 'nothing';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.length === 0 ? 'an empty list' : v.map(speakValue).join(', ');
  if (typeof v === 'object') return 'a value';
  return desugar(String(v));
}

/**
 * @param {import('./explain.js').Explanation | null} ex
 * @param {{step?: number, total?: number}} [ctx]
 * @returns {string} one sentence, or '' when there is nothing to announce
 */
export function announce(ex, ctx = {}) {
  if (!ex || ex.kind === 'none') return '';

  const parts = [];
  // Position first. A listener has no scrubber, and an announcement that opens
  // with the position lets them abandon the rest of it once oriented.
  if (typeof ctx.step === 'number' && typeof ctx.total === 'number') {
    parts.push(`Step ${ctx.step} of ${ctx.total}.`);
  }

  switch (ex.kind) {
    case 'init':
      parts.push(`${ex.created ?? 'structure'} created.`);
      break;

    case 'call': {
      const args = (ex.call?.args ?? []).map((a) => `${a.n} ${speakValue(a.v)}`);
      parts.push(args.length
        ? `Calls ${ex.call?.fn} with ${list(args)}.`
        : `Calls ${ex.call?.fn}.`);
      break;
    }

    case 'ret':
      parts.push(`Returns ${speakValue(ex.ret)}.`);
      break;

    case 'set': {
      const w = ex.writes ?? [];
      const said = w.map((x) => {
        const a = speakAddr(x.s, x.at);
        // A first write and an overwrite are different events to a listener:
        // "changes from" implies a previous value they may remember, and
        // claiming one where none existed is a small lie told on every fill.
        return x.from === null || x.from === undefined
          ? `${a} is set to ${speakValue(x.to)}`
          : `${a} changes from ${speakValue(x.from)} to ${speakValue(x.to)}`;
      });
      // Not sentence-cased: the first word is a structure name, and "dp" is
      // not "Dp". Case is inaudible to a screen reader, so capitalising buys
      // nothing and misnames the variable in a string that may also be logged.
      if (said.length) parts.push(list(said) + '.');
      break;
    }
  }

  if (ex.because) parts.push(`Because ${desugar(ex.because)}.`);

  if (ex.where && ex.where.length > 0) {
    const reads = ex.where.map((r) => `${speakAddr(r.s, r.at)}, which was ${desugar(r.value) || 'nothing'}`);
    parts.push(`Read ${list(reads)}.`);
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Oxford-free "a, b and c" -- read aloud, the extra comma is just a pause. */
function list(xs) {
  if (xs.length <= 1) return xs[0] ?? '';
  return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
}
