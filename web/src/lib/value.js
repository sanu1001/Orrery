// @ts-check
/**
 * Value helpers. Small, hot, and three of them are cross-language contracts:
 * `addrKey`, `canon` and `formatNum` must produce byte-identical output to
 * their Go twins in internal/trace, or the conformance suite fails with a step
 * number instead of a cause.
 */

/** JSON has no Infinity. Dijkstra's infinity travels as this string. */
export const INF = 'inf';

/**
 * The canonical address key: structure name, a space, then path segments
 * joined by '/'.
 *
 *   addrKey('dp', [3, 4])            -> 'dp 3/4'
 *   addrKey('L', ['$refs', 'slow'])  -> 'L $refs/slow'
 *
 * CRITICAL: must match trace.Path.KeyWith in internal/trace/path.go.
 *
 * @param {string} s
 * @param {Array<number|string>} at
 * @returns {string}
 */
export function addrKey(s, at) {
  return s + ' ' + at.join('/');
}

/** @param {*} v @returns {boolean} */
export function isRef(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && typeof v.$ === 'string';
}

/** @param {*} v @returns {string|null} */
export function refID(v) {
  return isRef(v) ? v.$ : null;
}

/**
 * Deep equality with the numeric normalisation the format requires: after a
 * JSON round trip every number is a double, so 7 and 7.0 are equal. NaN never
 * equals anything, including itself.
 */
export function deepEqual(a, b) {
  if (a === b) return !(typeof a === 'number' && Number.isNaN(a));
  if (a === null || b === null) return false;
  const ta = typeof a, tb = typeof b;
  if (ta === 'number' || tb === 'number') {
    return ta === tb && a === b;
  }
  if (ta !== 'object' || tb !== 'object') return false;

  const ra = refID(a), rb = refID(b);
  if (ra !== null || rb !== null) return ra === rb;

  const aArr = Array.isArray(a), bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

/** Structured deep clone, so state never aliases an event's payload. */
export function clone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(clone);
  const out = {};
  for (const k of Object.keys(v)) out[k] = clone(v[k]);
  return out;
}

/**
 * formatNum is JavaScript's own Number::toString, with one adjustment: -0
 * renders as "0". Go has to reimplement the ECMA-262 algorithm by hand to match
 * this (see formatNum in internal/trace/value.go); here it is free.
 * @param {number} n
 */
export function formatNum(n) {
  if (n === 0) return '0'; // collapses -0
  return String(n);
}

/**
 * canon renders a value in the canonical text form used by the state hash.
 * Must match trace.Canon exactly.
 * @param {*} v @returns {string}
 */
export function canon(v) {
  if (typeof v === 'number') return formatNum(v);
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return quote(v);
  const r = refID(v);
  if (r !== null) return '$' + r;
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => quote(k) + ':' + canon(v[k])).join(',') + '}';
}

/**
 * quote must match Go's strconv.Quote for the characters this format produces.
 * JSON.stringify agrees on printable ASCII, quotes, backslashes and the
 * standard escapes, which covers every string a trace carries.
 * @param {string} s
 */
function quote(s) {
  return JSON.stringify(s);
}

/**
 * Display formatting for renderers. Distinct from `canon`, which is for
 * hashing: this one is allowed to be pretty.
 * @param {*} v @returns {string}
 */
export function fmtValue(v) {
  if (v === null || v === undefined) return '';
  if (v === INF) return '∞';
  if (typeof v === 'number') return formatNum(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v;
  const r = refID(v);
  if (r !== null) return r;
  if (Array.isArray(v)) return '[' + v.map(fmtValue).join(', ') + ']';
  return '{…}';
}

/**
 * Human address label: `dp[3][4]` for numeric paths, `L.n3.next` for named
 * ones -- how a reader of the ALGORITHM would write them.
 * @param {string} name @param {Array<number|string>} at
 */
export function addrLabel(name, at) {
  if (!at || at.length === 0) return name;
  if (at.every((s) => typeof s === 'number')) {
    return name + at.map((i) => `[${i}]`).join('');
  }
  return name + at.map((s) => (typeof s === 'number' ? `[${s}]` : `.${s}`)).join('');
}
