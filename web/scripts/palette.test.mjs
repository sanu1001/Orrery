#!/usr/bin/env node
/**
 * Command palette tests.
 *
 * The two halves that do not need a browser: the matcher and the command list.
 * Both are pure, and both are where the behaviour someone would actually
 * notice lives -- a palette that ranks badly is worse than no palette, because
 * it costs a keystroke AND a decision.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { score, rank } from '../src/lib/fuzzy.js';
import { buildCommands } from '../src/lib/commands.js';
import { buildIndex } from '../src/player/prepass.js';
import { PlayerStore } from '../src/player/store.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

// --- matching ----------------------------------------------------------------
{
  check('an exact substring matches', score('merge', 'Merge Sort') > 0);
  check('so does a subsequence of initials', score('lca', 'Lowest Common Ancestor') > 0);
  check('and a gap in the middle', score('bfs', 'Breadth-First Search') > 0);
  check('letters not present do not match', score('zzz', 'Merge Sort') === -1);
  check('order matters — the letters must appear in sequence',
    score('tros', 'Merge Sort') === -1);
  check('an empty query matches everything, neutrally', score('', 'anything') === 0);

  // THE RANKING IS THE FEATURE. A palette that finds the right row in position
  // nine has not helped.
  check('word starts beat letters buried mid-word',
    score('bf', 'Breadth-First') > score('bf', 'Subframe'),
    `${score('bf', 'Breadth-First')} vs ${score('bf', 'Subframe')}`);
  check('a contiguous run beats a scattered one',
    score('sort', 'Merge Sort') > score('sort', 'Segment Tree, of Real Time'),
    `${score('sort', 'Merge Sort')} vs ${score('sort', 'Segment Tree, of Real Time')}`);
  check('shorter names win ties',
    score('dfs', 'DFS') > score('dfs', 'DFS over a forest'));
  check('matching is case-insensitive both ways',
    score('DFS', 'dfs') > 0 && score('dfs', 'DFS') > 0);
}

// --- ranking against the real catalogue --------------------------------------
{
  const names = [
    'Binary Search · Searching', 'Bubble Sort · Sorting', 'Merge Sort · Sorting',
    'Heapsort · Sorting', 'Dijkstra\'s Shortest Paths · Graphs',
    'Breadth-First Search (maze) · Graphs', 'Depth-First Search · Graphs',
    'Bellman-Ford · Graphs', 'BST Delete · Trees', 'BST Insert · Trees',
    'Lowest Common Ancestor · Trees', 'Merge Two Sorted Lists · Linked lists',
  ];
  const top = (q) => rank(names, q, (x) => x)[0];
  check('"dij" finds Dijkstra', top('dij').startsWith('Dijkstra'), top('dij'));
  check('"lca" finds the Lowest Common Ancestor',
    top('lca').startsWith('Lowest'), top('lca'));
  check('"heap" finds Heapsort', top('heap').startsWith('Heapsort'), top('heap'));
  check('"bells" finds Bellman-Ford', top('bells').startsWith('Bellman'), top('bells'));
  // The family is part of the matched text, which is the point of putting it
  // there rather than in the hint.
  check('a family name filters to that family',
    rank(names, 'graphs', (x) => x).every((n) => n.includes('Graphs')));
  check('nothing matching returns nothing', rank(names, 'qqq', (x) => x).length === 0);
  check('an empty query keeps the given order',
    rank(names, '', (x) => x).join('|') === names.join('|'));
}

// --- the command list --------------------------------------------------------
const DIR = fileURLToPath(new URL('../../testdata/golden/', import.meta.url));
const file = readdirSync(DIR).find((f) => f.startsWith('bst-insert'));
const trace = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
const store = new PlayerStore(trace, buildIndex(trace, 0), 0);

const CATALOG = [
  { id: 'merge', title: 'Merge Sort', family: 'Sorting' },
  { id: 'dijkstra', title: "Dijkstra's Shortest Paths", family: 'Graphs' },
];
const base = {
  catalog: CATALOG, algo: 'merge', store, trace,
  theme: 'dark', hueless: false, focus: null, breakpoints: [], query: '',
  actions: {},
};
const ids = (cmds) => cmds.map((c) => c.id);

{
  const cmds = buildCommands(base);
  check('every catalogue entry is a command',
    ids(cmds).includes('algo:merge') && ids(cmds).includes('algo:dijkstra'));
  check('the one on screen says so',
    cmds.find((c) => c.id === 'algo:merge').hint === 'showing');
  check('the transport is reachable',
    ['play', 'first', 'last'].every((id) => ids(cmds).includes(id)));
  check('and so are the view settings',
    ['detail', 'theme', 'hueless', 'keys'].every((id) => ids(cmds).includes(id)));

  // A command that silently does nothing is indistinguishable from a broken
  // one, which is the same rule the breakpoint rail already learned.
  check('with no address selected there is nothing to watch',
    !ids(cmds).includes('watch') && !ids(cmds).includes('break'));
  check('with no breakpoints set there is nothing to run to',
    !ids(cmds).includes('cont'));
  check('and with no save handler there is nothing to download',
    !ids(cmds).includes('save'));
}

{
  const cmds = buildCommands({
    ...base,
    focus: { kind: 'cell', s: 'tree', at: ['n3'] },
    breakpoints: [{ s: 'tree', at: ['n3'] }],
    actions: { save: () => {} },
  });
  check('a selected address brings the debugger commands with it',
    ids(cmds).includes('watch') && ids(cmds).includes('break'));
  check('and names the address it would act on',
    cmds.find((c) => c.id === 'watch').title.includes('tree.n3'),
    cmds.find((c) => c.id === 'watch').title);
  check('a set breakpoint makes continue reachable',
    ids(cmds).includes('cont') && ids(cmds).includes('contback'));
  check('a save handler makes the download reachable', ids(cmds).includes('save'));
}

// --- a number is a step ------------------------------------------------------
{
  check('a bare number offers the step, first',
    buildCommands({ ...base, query: '7' })[0].id === 'step');
  check('and it is clamped to the trace rather than refused',
    buildCommands({ ...base, query: '99999' })[0].title === `Step ${store.stepCount}`);
  check('a word is not a step', !ids(buildCommands({ ...base, query: 'merge' })).includes('step'));
  check('nor is an empty query', !ids(buildCommands({ ...base, query: '' })).includes('step'));
  check('nor is a negative number', !ids(buildCommands({ ...base, query: '-3' })).includes('step'));

  const before = store.step;
  buildCommands({ ...base, query: '4' })[0].run();
  check('and running it actually seeks', store.step === 4, `${before} -> ${store.step}`);
}

// --- the two halves together -------------------------------------------------
{
  const cmds = buildCommands({ ...base, query: 'dij' });
  const top = rank(cmds, 'dij', (c) => c.title)[0];
  check('typing three letters puts the algorithm first',
    top.id === 'algo:dijkstra', top.id);
}

console.log(failures === 0 ? '\npalette: all checks passed' : `\npalette: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
