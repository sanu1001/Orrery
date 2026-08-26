#!/usr/bin/env node
/**
 * Screen-reader announcement tests (C11).
 *
 * The property that matters is negative: no glyph may be load-bearing. A
 * screen reader at default punctuation settings drops arrows and middle dots
 * silently, so any meaning carried by one is meaning a blind user never
 * receives -- and nothing about the page looks broken, which is why this needs
 * a test rather than a review.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { explain } from '../src/lib/explain.js';
import { announce, speakAddr, speakValue } from '../src/lib/announce.js';
import { buildIndex } from '../src/player/prepass.js';
import { PlayerStore } from '../src/player/store.js';

const DIR = fileURLToPath(new URL('../../testdata/golden/', import.meta.url));
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

// Every glyph this codebase uses that a screen reader either skips or reads as
// a symbol name. If one reaches an announcement, it is carrying meaning that
// does not survive being spoken.
const MUTE = ['→', '←', '·', '∞', '≤', '≥', '≠', '—'];

// --- the core negative property, over every golden trace -------------------
const traces = readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => ({
  id: f.replace('.orrery.json', ''),
  t: JSON.parse(readFileSync(join(DIR, f), 'utf8')),
}));

let announced = 0;
let offenders = [];
for (const { id, t } of traces) {
  const index = buildIndex(t);
  const store = new PlayerStore(t, index);
  const total = index.steps.length;
  for (let s = 1; s <= total; s++) {
    store.seek(s);
    const line = announce(explain(store.currentEvents(), index), { step: s, total });
    announced++;
    for (const g of MUTE) {
      if (line.includes(g)) offenders.push(`${id} step ${s}: ${g} in "${line}"`);
    }
  }
}
check(`no muted glyph survives into speech — ${announced} announcements across ${traces.length} traces`,
  offenders.length === 0, offenders[0] ?? '');

// --- direction must be a word, not a character -----------------------------
const overwrite = explain([{ t: 'set', s: 'dp', at: [5, 5], from: 0, to: 3 }]);
const first = explain([{ t: 'set', s: 'dp', at: [5, 5], from: null, to: 3 }]);
check('an overwrite says which value came first',
  announce(overwrite).includes('changes from 0 to 3'), announce(overwrite));
check('a first write does not claim a previous value',
  announce(first).includes('is set to 3') && !announce(first).includes('changes from'),
  announce(first));
check('the visual form still uses the compact glyph (unchanged)',
  overwrite.lead === 'dp[5][5]: 0 → 3', overwrite.lead);

// --- a grouped swap must mention both writes -------------------------------
const swap = explain([
  { t: 'set', s: 'a', at: [0], from: 5, to: 2, note: 'swap' },
  { t: 'set', s: 'a', at: [1], from: 2, to: 5 },
]);
const swapLine = announce(swap);
check('a grouped swap announces both writes',
  swapLine.includes('a 0 changes from 5 to 2') && swapLine.includes('a 1 changes from 2 to 5'),
  swapLine);

// --- orientation ------------------------------------------------------------
check('the step position leads the announcement, standing in for the scrubber',
  announce(overwrite, { step: 7, total: 43 }).startsWith('Step 7 of 43.'));
check('and is omitted rather than guessed when unknown',
  !announce(overwrite).startsWith('Step'));

// --- values a listener would otherwise lose --------------------------------
check('infinity is a word', speakValue('inf') === 'infinity');
check('an unreachable cell speaks its value',
  announce(explain([{ t: 'set', s: 'memo', at: [3], from: null, to: 'inf' }])).includes('infinity'));
check('booleans survive', speakValue(true) === 'true');

// --- addresses --------------------------------------------------------------
check('a numeric address drops its brackets — four fewer spoken words per address',
  speakAddr('dp', [5, 5]) === 'dp 5 5');
check('a named path stays readable', speakAddr('L', ['n3', 'next']) === 'L n3 next');
check('a scalar has no path at all', speakAddr('lo', []) === 'lo');
check('an identifier is not sentence-cased — "dp" is not "Dp"',
  announce(overwrite).includes('dp 5 5') && !announce(overwrite).includes('Dp 5 5'));

// --- nothing to say is said as nothing -------------------------------------
check('an empty step announces nothing at all', announce(explain([])) === '');
check('and so does a null explanation', announce(null) === '');

// --- speech and sight must not drift ---------------------------------------
// Both are derived from the same structured fields, so a change to one that
// forgets the other shows up here rather than only for users who cannot see.
let drift = 0;
for (const { t } of traces) {
  const index = buildIndex(t);
  const store = new PlayerStore(t, index);
  for (let s = 1; s <= index.steps.length; s++) {
    store.seek(s);
    const ex = explain(store.currentEvents(), index);
    if (ex.kind !== 'set' || !ex.writes) continue;
    const line = announce(ex);
    for (const w of ex.writes) {
      if (!line.includes(speakAddr(w.s, w.at))) drift++;
    }
  }
}
check('every address in the visual form also reaches the spoken form', drift === 0, `${drift} missing`);

console.log(failures === 0 ? '\nannounce: all checks passed' : `\nannounce: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
