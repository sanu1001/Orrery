#!/usr/bin/env node
/**
 * Address family tests.
 *
 * One rule has to serve a 6x6 board, a 7x8 DP table and a linked list, without
 * knowing which it is holding. The interesting case is the list: its addresses
 * end in a FIELD name (`list.n2.next`), so the obvious implementation -- always
 * wildcard the last segment -- produces `list.n2.*`, a family of one, and the
 * panel silently shows nothing useful. The axis has to be derived.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex } from '../src/player/prepass.js';
import { familyOf, familyLabel, cellState } from '../src/lib/family.js';

const DIR = fileURLToPath(new URL('../../testdata/golden/', import.meta.url));
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const load = (id) => JSON.parse(readFileSync(join(DIR, `${id}.orrery.json`), 'utf8'));

// --- a grid: the family is the rest of the row -------------------------------
{
  const t = load('nqueens');
  const u = buildIndex(t).structUnion;
  const fam = familyOf('board', [3, 4], u);
  check('a grid write has a family', !!fam);
  check('it varies the last axis — the column', fam.axis === 1, `axis ${fam.axis}`);
  check('and spans the DECLARED width, not just the cells written so far — the panel shows the shape a run will fill before it fills it',
    fam.members.length === 6, `${fam.members.length} members`);
  check('every member keeps the row fixed', fam.members.every((m) => m[0] === 3));
  check('the written address is one of its own siblings',
    fam.members.some((m) => m[0] === 3 && m[1] === 4));
  check('the label marks the free position', familyLabel('board', [3, 4], 1) === 'board[3][·]',
    familyLabel('board', [3, 4], 1));
}

// --- a linked list: the family must vary the NODE, not the field ------------
{
  const t = load('list-reverse');
  const u = buildIndex(t).structUnion;
  const fam = familyOf('list', ['n2', 'next'], u);
  check('a pointer field has a family', !!fam);
  // The whole point. Wildcarding the last segment gives list.n2.* -- one member,
  // an empty panel, and no error anywhere to explain it.
  check('it varies the NODE and not the field name — the last segment is `next`, which has no siblings',
    fam.axis === 0, `axis ${fam.axis}`);
  check('so the family is every .next pointer in the list',
    fam.members.length > 1 && fam.members.every((m) => m[1] === 'next'),
    `${fam.members.length} members, e.g. ${JSON.stringify(fam.members[0])}`);
  check('members are ordered so node[10] does not sort before node[2]',
    JSON.stringify(fam.members.map((m) => m[0])) === JSON.stringify([...fam.members.map((m) => m[0])].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))),
    fam.members.map((m) => m[0]).join(','));
  check('the label marks the node position', familyLabel('list', ['n2', 'next'], 0) === 'list[·].next',
    familyLabel('list', ['n2', 'next'], 0));
}

// --- a DP table -------------------------------------------------------------
{
  const t = load('lcs');
  const u = buildIndex(t).structUnion;
  const fam = familyOf('dp', [3, 4], u);
  check('a DP write families into its row', !!fam && fam.axis === 1, fam ? `axis ${fam.axis}` : 'none');
  check('and the row is the full declared width', fam.members.length === 8, `${fam.members.length}`);
}

// --- things with no family --------------------------------------------------
{
  const t = load('nqueens');
  const u = buildIndex(t).structUnion;
  check('a scalar cursor has no family rather than a family of one',
    familyOf('board', [], u) === null);
  check('an unknown structure has no family', familyOf('nope', [1], u) === null);
  check('a missing union is survivable', familyOf('board', [1, 2], undefined) === null);
}

// --- nothing in the corpus crashes, and every member is well formed --------
{
  const ids = readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace('.orrery.json', ''));
  let checked = 0, bad = [];
  for (const id of ids) {
    const t = load(id);
    const u = buildIndex(t).structUnion;
    for (const e of t.events) {
      if (e.t !== 'set') continue;
      const fam = familyOf(e.s, e.at ?? [], u);
      if (!fam) continue;
      checked++;
      if (fam.axis < 0 || fam.axis >= (e.at ?? []).length) bad.push(`${id}: axis ${fam.axis} out of range`);
      for (const m of fam.members) {
        if (m.length !== (e.at ?? []).length) { bad.push(`${id}: member arity ${m.length}`); break; }
      }
      // The address that produced the family must appear in it, or the panel
      // highlights a cell that is not on screen.
      const self = fam.members.some((m) => m.every((seg, i) => String(seg) === String(e.at[i])));
      if (!self) bad.push(`${id}: ${e.s}${JSON.stringify(e.at)} is missing from its own family`);
    }
  }
  check(`every write in the corpus families cleanly — ${checked} addresses across ${ids.length} traces`,
    bad.length === 0, bad[0] ?? '');
}

// --- cellState: the rule that has now been got wrong twice ------------------
// Both failures came from reading the current VALUE instead of the last WRITE,
// both were silent, and both looked plausible on screen. These are the exact
// shapes that broke.
{
  const S = (o) => cellState({ pointer: false, writtenNow: false, readNow: false, ...o });

  check('a cell nothing has written is empty, not settled',
    S({ write: undefined, fill: 0 }) === 'empty');

  // N-Queens: a queen taken back. 1 -> 0 where the fill is 0.
  check('a value returning to the fill from a real value is undone',
    S({ write: { from: 1, to: 0 }, fill: 0 }) === 'undone');

  // LCS: row 1 of an alignment table legitimately computes 0 into a cell that
  // already holds 0. Reading the value alone called this backtracking and
  // painted a monotone DP fill rose.
  check('a computed value that happens to equal the fill is settled, not undone — the LCS regression',
    S({ write: { from: 0, to: 0 }, fill: 0 }) === 'settled');

  // list-reverse: `cur = nil` ends the walk; a tail's `.next` is null because
  // it is the tail. Neither is a retraction.
  check('a pointer going null is settled, not undone — the list-reverse regression',
    S({ write: { from: { $: 'n1' }, to: null }, fill: null, pointer: true }) === 'settled');
  check('but a non-pointer going null with the same shape is still undone',
    S({ write: { from: { $: 'n1' }, to: null }, fill: null, pointer: false }) === 'undone');

  check('the address written this step reads as written', S({ write: { from: 0, to: 1 }, fill: 0, writtenNow: true }) === 'written');
  check('writing this step still shows a retraction as undone',
    S({ write: { from: 1, to: 0 }, fill: 0, writtenNow: true }) === 'undone');
  check('a read this step outranks its settled history',
    S({ write: { from: 0, to: 3 }, fill: 0, readNow: true }) === 'read');
  check('a sentinel fill works the same way — nothing assumes 0 or null',
    S({ write: { from: 5, to: 999 }, fill: 999 }) === 'undone'
    && S({ write: { from: 999, to: 999 }, fill: 999 }) === 'settled');
}

console.log(failures === 0 ? '\nfamily: all checks passed' : `\nfamily: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
