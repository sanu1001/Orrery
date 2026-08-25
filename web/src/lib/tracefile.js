// @ts-check
import { validate, hasErrors } from './validate.js';

/**
 * The trace as a FILE, in both directions.
 *
 * The point of C6 is that `.orrery.json` stops being an implementation detail
 * and becomes an artifact: something you download, mail to someone, check into
 * a bug report, and drag back in a week later. That claim is only worth making
 * if a file arriving from outside gets the same treatment as one we served --
 * which is why the same V1..V14 validator runs here. ROADMAP.md C6.
 *
 * Nothing in this module touches the DOM. That is deliberate: it is the whole
 * trust boundary, so it has to be testable in Node next to the player.
 */

/**
 * A dropped file is untrusted input, and `JSON.parse` on a gigabyte hangs the
 * tab long before the validator gets an opinion about it.
 *
 * 8 MiB is not a guessed round number: it is `tracer.DefaultMaxBytes`, the
 * producer's own byte cap. A file bigger than a tracer can emit did not come
 * from one, so refusing it costs nothing real and the message can say why.
 */
export const MAX_FILE_BYTES = 8 << 20;

/** @typedef {import('./validate.js').Diag} Diag */
/** @typedef {{ok: boolean, trace: any, diags: Diag[], error: string}} ParseResult */

/**
 * The name a downloaded trace gets.
 *
 * A trace that arrived as a file keeps the name it arrived under. Renaming it
 * to match `meta.algo` means saving `lcs-custom.orrery.json` back out as
 * `lcs.orrery.json`, straight over the catalogue's copy sitting in the same
 * downloads folder -- a surprising way to lose the wrong file.
 *
 * @param {*} trace
 * @param {string} [preferred] the name it came in as, if it came from a file
 * @returns {string}
 */
export function traceFilename(trace, preferred = '') {
  // Both branches go through the allowlist. `meta.algo` is a field in a file
  // that may not have come from us, and while browsers do sanitise download
  // names, leaning on that is how "download" quietly becomes a write-anywhere
  // primitive.
  const clean = (s) => String(s ?? '').replace(/[^A-Za-z0-9._-]/g, '');
  const from = clean(preferred);
  if (from) return from;
  const id = clean(trace?.meta?.algo);
  return `${id || 'trace'}.orrery.json`;
}

/**
 * Parse and validate a file's text.
 *
 * Returns rather than throws, because every failure here is something the UI
 * has to SHOW rather than swallow: a half-finished download, somebody's
 * `package.json`, a trace from a version this build predates. `ok:false` with
 * an empty `error` means the file parsed but the validator rejected it, and
 * `diags` is then the explanation to render.
 *
 * @param {string} text
 * @returns {ParseResult}
 */
export function parseTraceFile(text) {
  /** @type {(error: string) => ParseResult} */
  const fail = (error) => ({ ok: false, trace: null, diags: [], error });

  // String length counts UTF-16 code units, and UTF-8 never encodes a code
  // unit in less than a byte, so this can only ever under-report the file
  // size -- it rejects nothing a byte count would have allowed through.
  if (text.length > MAX_FILE_BYTES) {
    return fail(`that file is larger than the ${MAX_FILE_BYTES >> 20} MiB byte cap a tracer runs under, ` +
      'so it did not come from one');
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return fail(`that file isn't JSON — ${err instanceof Error ? err.message : String(err)}`);
  }

  // An array or a bare number is valid JSON and would sail into the validator,
  // which reports its findings against `trace.meta` and produces a wall of
  // confusing diagnostics instead of the one true sentence.
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('that file is JSON, but not a trace object');
  }

  const diags = validate(raw);
  if (hasErrors(diags)) return { ok: false, trace: null, diags, error: '' };
  return { ok: true, trace: raw, diags, error: '' };
}
