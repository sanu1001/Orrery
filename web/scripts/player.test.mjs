#!/usr/bin/env node
/**
 * JS-side player tests. The Go/JS conformance suite already proves the two
 * agree about STATE; these cover the things only the JS side has: the store's
 * navigation, the pre-pass indexes, and the explanation template.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, hasErrors } from '../src/lib/validate.js';
import { buildIndex } from '../src/player/prepass.js';
import { PlayerStore } from '../src/player/store.js';
import { explain } from '../src/lib/explain.js';
import { parseTraceFile, traceFilename, MAX_FILE_BYTES } from '../src/lib/tracefile.js';

// fileURLToPath, not `.pathname`: on Windows the latter yields "/D:/..." with a
// leading slash, which readdir then resolves against the current drive as
// "D:\D:\...". Linux CI never sees it, so the bug only exists on a dev machine.
const DIR = fileURLToPath(new URL('../../testdata/golden/', import.meta.url));
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const traces = readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => ({
  id: f.replace('.orrery.json', ''),
  t: JSON.parse(readFileSync(join(DIR, f), 'utf8')),
}));

// --- the validator is the trust boundary: every golden must pass it ---------
for (const { id, t } of traces) {
  const diags = validate(t);
  check(`${id}: validates`, !hasErrors(diags),
    diags.filter((d) => d.severity === 'error').map((d) => d.message)[0] ?? '');
}

// --- round trip and seek equivalence, JS side ------------------------------
for (const { id, t } of traces) {
  const index = buildIndex(t, 0);
  const s = new PlayerStore(t, index, 0);
  const h0 = s.state.hash();
  s.seek(s.stepCount);
  s.seek(0);
  check(`${id}: forward-then-backward returns to the start`, s.state.hash() === h0);

  // Seek must be compared from a NON-ZERO, NON-MONOTONIC position, or it only
  // ever exercises forward replay and would pass with a broken prev().
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % (n + 1); };
  let ok = true;
  for (let i = 0; i < 40 && ok; i++) {
    const k = rnd(s.stepCount);
    s.seek(k);
    const fresh = new PlayerStore(t, buildIndex(t, 0), 0);
    for (let j = 0; j < k; j++) fresh.next();
    if (s.state.hash() !== fresh.state.hash()) ok = false;
  }
  check(`${id}: seek equals stepping, from arbitrary positions`, ok);
}

// --- grouping: a swap is ONE step and rewinds cleanly -----------------------
{
  const { t } = traces.find((x) => x.id === 'bubble');
  const s = new PlayerStore(t, buildIndex(t, 0), 0);
  const groups = new Set(t.events.filter((e) => e.g).map((e) => e.g));
  const grouped = t.events.filter((e) => e.g).length;
  check('bubble: swaps are grouped', groups.size > 0 && grouped > groups.size,
    `${groups.size} groups over ${grouped} events`);
  check('bubble: fewer steps than events (grouping collapses them)',
    s.stepCount < t.events.length, `${s.stepCount} steps, ${t.events.length} events`);
}

// --- detail levels change the step count but not the state -----------------
//
// Uses bubble, not binary. In bubble sort the scan pointers are genuinely
// DETAIL -- the swaps are the algorithm -- so they sit at level 1. In binary
// search the cursors ARE the algorithm (three comparisons, zero writes to the
// array), so they stay at level 0 and filtering them would leave an empty
// trace. Same mechanism, opposite call, and the difference is a judgement the
// algorithm author makes. FLAWS.md 1.
{
  const { t } = traces.find((x) => x.id === 'bubble');
  const s0 = new PlayerStore(t, buildIndex(t, 0), 0);
  const s1 = new PlayerStore(t, buildIndex(t, 1), 1);
  check('bubble: detail level 1 has more steps than level 0',
    s1.stepCount > s0.stepCount, `${s0.stepCount} vs ${s1.stepCount}`);
  s0.seek(s0.stepCount);
  s1.seek(s1.stepCount);
  // The non-aux array must end in the same state at either level. That is the
  // soundness claim of ADR 0016, tested.
  const arrOf = (s) => JSON.stringify([...s.struct('a').flat.entries()].sort());
  check('bubble: the non-aux array ends identical at both detail levels',
    arrOf(s0) === arrOf(s1));
}

// --- the pre-pass finds memo hits structurally -----------------------------
{
  const { t } = traces.find((x) => x.id === 'coins-memo');
  const idx = buildIndex(t, 0);
  const hits = idx.callTree.nodes.filter((n) => n.isMemoHit);
  check('coins-memo: memo hits are detected', hits.length > 0, `${hits.length} hits`);
  const cited = hits.filter((n) => n.memoSrc >= 0);
  check('coins-memo: memo hits resolve back to the node that computed the value',
    cited.length > 0, `${cited.length} of ${hits.length} resolved`);
  check('coins-memo: a memo hit is always a leaf', hits.every((n) => n.kids.length === 0));
}

// --- explanations name exactly the cells in deps ---------------------------
{
  const { t } = traces.find((x) => x.id === 'lcs');
  const idx = buildIndex(t, 0);
  const s = new PlayerStore(t, idx, 0);
  s.seek(6);
  const ex = explain(s.currentEvents(), idx);
  const deps = s.currentEvents().flatMap((e) => e.deps ?? []);
  check('lcs: the explanation lists every dep and no more',
    ex.where.length === deps.length && ex.where.length > 0,
    `${ex.where.length} listed, ${deps.length} deps`);
  check('lcs: the explanation has a lead and a reason', !!ex.lead && !!ex.because,
    `${ex.lead} — ${ex.because}`);
}

// --- firstWrite powers the computed-vs-untouched distinction ----------------
{
  const { t } = traces.find((x) => x.id === 'lcs');
  const idx = buildIndex(t, 0);
  check('lcs: firstWrite indexes every written cell',
    idx.firstWrite.size === new Set(t.events.filter((e) => e.t === 'set')
      .map((e) => `${e.s} ${(e.at ?? []).join('/')}`)).size);
}

// --- the pre-pass stays off the critical path -------------------------------
{
  const biggest = traces.reduce((a, b) => (a.t.events.length > b.t.events.length ? a : b));
  const t0 = performance.now();
  buildIndex(biggest.t, 0);
  const ms = performance.now() - t0;
  check(`pre-pass on the largest golden (${biggest.id}, ${biggest.t.events.length} events) is under 50ms`,
    ms < 50, `${ms.toFixed(1)}ms`);
}

// --- the trace as a file: C6's trust boundary -------------------------------
// A dropped file is the least trusted input the app takes. These cover the
// shapes that actually arrive: the real thing, a half-finished download,
// somebody's package.json, and a file far too big to be a trace at all.
{
  for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
    const res = parseTraceFile(readFileSync(join(DIR, f), 'utf8'));
    check(`${f}: opens as a file`, res.ok, res.error || (res.diags[0]?.message ?? ''));
  }

  const good = readFileSync(join(DIR, 'lcs.orrery.json'), 'utf8');

  const cut = parseTraceFile(good.slice(0, good.length >> 1));
  check('a truncated download is rejected as not-JSON',
    !cut.ok && /isn't JSON/.test(cut.error), cut.error);

  const arr = parseTraceFile('[1,2,3]');
  check('valid JSON that is not an object is rejected before the validator',
    !arr.ok && /not a trace object/.test(arr.error), arr.error);

  // The distinguishing case: it parses, so the failure has to come back as
  // validator DIAGNOSTICS for the UI to render, not as a one-line error.
  const notATrace = parseTraceFile('{"name":"orrery-web","version":"1.0.0"}');
  check('a JSON object that is not a trace comes back as diagnostics, not an error',
    !notATrace.ok && notATrace.error === '' && notATrace.diags.length > 0,
    `${notATrace.diags.length} diags`);

  const huge = parseTraceFile('"' + 'x'.repeat(MAX_FILE_BYTES + 1) + '"');
  check('a file over the tracer byte cap is refused without parsing',
    !huge.ok && /byte cap/.test(huge.error), huge.error);

  check('the download is named after the algorithm',
    traceFilename(JSON.parse(good)) === 'lcs.orrery.json', traceFilename(JSON.parse(good)));
  check('a hostile meta.algo cannot escape the download name',
    traceFilename({ meta: { algo: '../../etc/passwd' } }) === '....etcpasswd.orrery.json',
    traceFilename({ meta: { algo: '../../etc/passwd' } }));
  check('a trace that came from a file keeps the name it came in as',
    traceFilename(JSON.parse(good), 'lcs-custom.orrery.json') === 'lcs-custom.orrery.json',
    traceFilename(JSON.parse(good), 'lcs-custom.orrery.json'));
  check('a hostile incoming filename is cleaned the same way',
    traceFilename({}, '../../evil.json') === '....evil.json',
    traceFilename({}, '../../evil.json'));
  check('a trace with no algo still gets a name',
    traceFilename({}) === 'trace.orrery.json', traceFilename({}));
}

console.log(failures === 0 ? '\nplayer: all checks passed' : `\nplayer: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
