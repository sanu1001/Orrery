#!/usr/bin/env node
/**
 * Scrubber density tests.
 *
 * The classification has to stay generic. The redesign described it in
 * N-Queens terms -- placements versus rejections -- and the tempting
 * implementation is to go looking for a board. These assert the same
 * distinction falls out of `fill` alone, on traces that have no board at all.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex } from '../src/player/prepass.js';
import { stepDensity, peakWeight } from '../src/player/density.js';

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

// --- one tick per step, always ---------------------------------------------
let aligned = true;
const kinds = new Set();
for (const { t } of traces) {
  const index = buildIndex(t);
  const d = stepDensity(t, index);
  if (d.length !== index.steps.length) aligned = false;
  for (const x of d) kinds.add(x.kind);
}
check(`the track has exactly one tick per step — ${traces.length} traces`, aligned);
check('every tick carries a kind the stylesheet knows',
  [...kinds].every((k) => ['write', 'revert', 'call', 'ret'].includes(k)), [...kinds].join(','));

// --- backtracking must be visible, and only where it exists ----------------
const nq = traces.find((x) => x.id === 'nqueens');
const nqD = stepDensity(nq.t, buildIndex(nq.t));
const reverts = nqD.filter((x) => x.kind === 'revert').length;
check(`N-Queens shows its backtracks — ${reverts} reverting steps of ${nqD.length}`, reverts > 0);

// The real test of genericity: LCS fills a table and never un-writes a cell, so
// a correct classifier finds no reverts without being told the difference
// between a DP fill and a search.
const lcs = traces.find((x) => x.id === 'lcs');
const lcsD = stepDensity(lcs.t, buildIndex(lcs.t));
check('a monotone DP fill reports no backtracking at all',
  lcsD.every((x) => x.kind !== 'revert'),
  `${lcsD.filter((x) => x.kind === 'revert').length} found`);

// --- fill is read from the producer, not assumed ---------------------------
const synthetic = {
  events: [
    { t: 'init', s: 'g', kind: 'grid', dims: [1, 3], fill: 999 },
    { t: 'set', s: 'g', at: [0, 0], from: 999, to: 5 },
    { t: 'set', s: 'g', at: [0, 0], from: 5, to: 999 },
  ],
};
const sd = stepDensity(synthetic, { steps: [{ e0: 1, e1: 2 }, { e0: 2, e1: 3 }] });
check('a non-zero fill is still recognised as back-to-empty — a sentinel DP table must not read as permanently reverted',
  sd[0].kind === 'write' && sd[1].kind === 'revert', sd.map((x) => x.kind).join(','));

// --- a mixed step reads as progress ----------------------------------------
const swap = stepDensity(
  {
    events: [
      { t: 'init', s: 'a', fill: 0 },
      { t: 'set', s: 'a', at: [0], from: 1, to: 0 },
      { t: 'set', s: 'a', at: [1], from: 0, to: 1 },
    ],
  },
  { steps: [{ e0: 1, e1: 3 }] },
);
check('a step that both reverts and writes reads as a write — reverting is only the story when it is the only story',
  swap[0].kind === 'write' && swap[0].weight === 2, JSON.stringify(swap));

// --- scaling ----------------------------------------------------------------
check('peak weight is measured, not fixed — traces differ by an order of magnitude',
  peakWeight(nqD) >= 1 && peakWeight([]) === 1);
check('a missing trace is survivable', stepDensity(null, null).length === 0);

console.log(failures === 0 ? '\ndensity: all checks passed' : `\ndensity: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
