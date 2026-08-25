#!/usr/bin/env node
/**
 * The three tidy-tree tests, written BEFORE the renderer and run before it.
 *
 * A wrong `apportion` produces subtrees that overlap almost correctly, which
 * costs a day of not noticing. These three properties catch it immediately:
 *
 *   1. a complete binary tree is symmetric about its root
 *   2. a left spine is a straight diagonal
 *   3. identical subtrees have identical RELATIVE coordinates
 *
 * Plus one that is about the browser rather than the maths: a 5,000-deep spine
 * must not blow the JavaScript stack.
 */

import { tidyTree } from '../src/render/layout/tidyTree.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// --- 1. a complete binary tree of depth 4 is symmetric ----------------------
{
  const depth = 4;
  const kids = [];
  const build = (d) => {
    const me = kids.length;
    kids.push([]);
    if (d < depth) {
      const l = build(d + 1);
      const r = build(d + 1);
      kids[me] = [l, r];
    }
    return me;
  };
  build(0);
  const L = tidyTree({ kids, roots: [0], depth: [] }, 40, 24);

  const rootX = L.x[0];
  let symmetric = true;
  const byDepth = new Map();
  const walk = (v, d) => {
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d).push(L.x[v]);
    for (const c of kids[v]) walk(c, d + 1);
  };
  walk(0, 0);
  for (const [, xs] of byDepth) {
    xs.sort((a, b) => a - b);
    for (let i = 0, j = xs.length - 1; i < j; i++, j--) {
      if (!near(xs[i] - rootX, -(xs[j] - rootX), 1e-6)) symmetric = false;
    }
  }
  check('complete binary tree of depth 4 is symmetric about its root', symmetric);

  // Every parent sits exactly between its two children.
  let centred = true;
  for (let v = 0; v < kids.length; v++) {
    if (kids[v].length === 2) {
      const mid = (L.x[kids[v][0]] + L.x[kids[v][1]]) / 2;
      if (!near(L.x[v], mid, 1e-6)) centred = false;
    }
  }
  check('every parent is centred over its children', centred);
}

// --- 2. a left spine is a straight diagonal ---------------------------------
{
  const n = 10;
  const kids = Array.from({ length: n }, (_, i) => (i < n - 1 ? [i + 1] : []));
  const L = tidyTree({ kids, roots: [0], depth: [] }, 40, 24);
  let straight = true;
  for (let i = 0; i < n; i++) if (!near(L.x[i], L.x[0])) straight = false;
  check('a single-child spine is vertical (each node centred on its only child)', straight);

  let descending = true;
  for (let i = 1; i < n; i++) if (!(L.y[i] > L.y[i - 1])) descending = false;
  check('depth increases monotonically down the spine', descending);
}

// --- 3. identical subtrees are drawn identically ----------------------------
{
  //        0
  //     /  |  \
  //    1   4   7        each of 1,4,7 is a parent of two leaves
  const kids = [[1, 4, 7], [2, 3], [], [], [5, 6], [], [], [8, 9], [], []];
  const L = tidyTree({ kids, roots: [0], depth: [] }, 40, 24);
  const rel = (p) => kids[p].map((c) => L.x[c] - L.x[p]);
  const a = rel(1), b = rel(4), c = rel(7);
  const same = a.every((v, i) => near(v, b[i]) && near(v, c[i]));
  check('three identical subtrees have identical relative coordinates', same,
    `[${a.map((v) => v.toFixed(1))}] vs [${b.map((v) => v.toFixed(1))}] vs [${c.map((v) => v.toFixed(1))}]`);

  // And they must not overlap: sibling gaps are at least one node width apart.
  const xs = [L.x[1], L.x[4], L.x[7]].sort((p, q) => p - q);
  check('adjacent subtrees do not overlap', xs[1] - xs[0] >= 40 && xs[2] - xs[1] >= 40);
}

// --- 4. a deep spine must not blow the JS stack -----------------------------
{
  const n = 5000;
  const kids = Array.from({ length: n }, (_, i) => (i < n - 1 ? [i + 1] : []));
  let ok = true;
  try {
    tidyTree({ kids, roots: [0], depth: [] }, 40, 24);
  } catch (err) {
    ok = false;
    console.error('   ', err.message);
  }
  check('a 5,000-deep spine lays out without a stack overflow', ok);
}

// --- 5. a forest is laid out side by side, not on top of itself -------------
{
  const kids = [[1, 2], [], [], [4], []];
  const L = tidyTree({ kids, roots: [0, 3], depth: [] }, 40, 24);
  check('a forest places its second root clear of the first', L.x[3] > L.x[2]);
}

console.log(failures === 0 ? '\ntidyTree: all properties hold' : `\ntidyTree: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
