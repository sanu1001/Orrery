#!/usr/bin/env node
/**
 * Code-pane structure tests: the import fold and the gutter's hit counts.
 *
 * The fold exists because the redesign measured something real -- about twelve
 * of the first twenty-three lines of an algorithm file are package, import and
 * //go:embed plumbing, so the function you opened the pane to read starts below
 * the fold. These tests keep that saving honest and, more importantly, keep the
 * fold from ever hiding a line that executes.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldableRanges, lineHits, peakHits } from '../src/lib/source.js';
import { buildIndex } from '../src/player/prepass.js';

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

// --- THE safety property ---------------------------------------------------
// The code pane's entire justification is that `ln` puts execution on screen.
// A fold that can swallow the line an event points at would make the pane lie
// about where execution is, and it would do so silently.
let hidden = [];
for (const { id, t } of traces) {
  const src = t.meta.source;
  if (!src) continue;
  const folds = foldableRanges(src.text, t.meta.lang, src.firstLine || 1);
  for (const e of t.events) {
    if (!e.ln) continue;
    for (const f of folds) {
      if (e.ln >= f.from && e.ln <= f.to) hidden.push(`${id}: event at line ${e.ln} is inside fold ${f.from}-${f.to}`);
    }
  }
}
check(`no fold hides a line an event points at — ${traces.length} traces`,
  hidden.length === 0, hidden[0] ?? '');

// --- the saving is real and worth the pill ---------------------------------
let totalHidden = 0, folded = 0;
for (const { t } of traces) {
  const src = t.meta.source;
  if (!src) continue;
  const folds = foldableRanges(src.text, t.meta.lang, src.firstLine || 1);
  if (folds.length) folded++;
  totalHidden += folds.reduce((a, f) => a + (f.to - f.from + 1), 0);
}
const avg = totalHidden / traces.length;
check(`every Go source folds its prologue — ${folded}/${traces.length}`, folded === traces.length);
// Numeric, not "looks shorter". If a future refactor trims the prologue, this
// says so, and the pill may stop being worth its click.
check(`the fold hides the whole prologue — ${avg.toFixed(1)} lines per file`,
  avg >= 9 && avg <= 48, `${totalHidden} lines across ${traces.length} files`);

// --- the pill has to say what it hid ---------------------------------------
const one = traces.find((x) => x.t.meta.source);
const f0 = foldableRanges(one.t.meta.source.text, one.t.meta.lang, one.t.meta.source.firstLine || 1)[0];
check('the pill names the import count rather than saying "…"',
  /^package(,| and) \d+ imports?( and the registration)?$/.test(f0.label), f0.label);
check('the fold starts at the first line of the file', f0.from === (one.t.meta.source.firstLine || 1));

// --- languages other than Go ------------------------------------------------
check('a non-Go source folds nothing rather than guessing at its syntax',
  foldableRanges('#include <vector>\nint main(){}', 'cpp', 1).length === 0);
check('an empty source folds nothing', foldableRanges('', 'go', 1).length === 0);

// --- a pill must be worth its click ----------------------------------------
check('a package line with no imports is not folded — a pill hiding one line costs a click and saves nothing',
  foldableRanges('package main\n\nfunc main() {}\n', 'go', 1).length === 0);

// --- single-line import form ------------------------------------------------
const single = foldableRanges('package x\n\nimport "fmt"\nimport "os"\n\nfunc f(){}', 'go', 1);
check('consecutive single-line imports fold as one range', single.length === 1 && single[0].to === 4,
  JSON.stringify(single));

// --- gutter hit counts ------------------------------------------------------
const nq = traces.find((x) => x.id === 'nqueens');
if (nq) {
  const index = buildIndex(nq.t);
  const peak = peakHits(index.lineIndex);
  check('the gutter can count how often a line runs', peak > 0, `busiest line runs ${peak} times`);
  // The count was already sitting in lineIndex behind a tooltip; this asserts
  // the helper reads the same index the click-to-jump behaviour uses.
  let agree = true;
  for (const [ln, steps] of index.lineIndex) if (lineHits(index.lineIndex, ln) !== steps.length) agree = false;
  check('hit counts come from the same index that makes lines clickable', agree);
  check('a line that never runs reports zero, not undefined', lineHits(index.lineIndex, 99999) === 0);
}
check('a missing index is survivable', lineHits(undefined, 1) === 0 && peakHits(undefined) === 0);

console.log(failures === 0 ? '\nsource: all checks passed' : `\nsource: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
