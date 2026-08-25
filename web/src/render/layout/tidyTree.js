// @ts-check
/**
 * Tidy tree layout: Reingold–Tilford, in the linear-time formulation of
 *
 *   Buchheim, Jünger & Leipert, "Improving Walker's Algorithm to Run in Linear
 *   Time", Graph Drawing 2002
 *
 * which corrects Walker (1990). Cite this; it is the standard reference and the
 * correct one. Do NOT improvise `apportion` -- a wrong implementation produces
 * subtrees that overlap *almost* correctly, which is worse than obviously
 * broken because you lose a day not noticing.
 *
 * Four aesthetic guarantees, and the third is the one that matters here:
 *
 *   1. parents are centred over their children
 *   2. the drawing is symmetric under reflection
 *   3. IDENTICAL SUBTREES ARE DRAWN IDENTICALLY wherever they appear
 *   4. no overlaps, and the drawing is as narrow as those constraints allow
 *
 * (3) is what makes a recursion tree readable: coins(6) appearing in three
 * places looks the same in all three, so the eye recognises the repetition --
 * which is the entire pedagogical point of showing the tree beside a memo
 * table.
 *
 * BOTH WALKS ARE ITERATIVE. A recursive first walk blows the JavaScript stack
 * on an unmemoized fib, whose call tree has a spine thousands deep, and the
 * symptom is a browser error that looks like our bug. This is not hypothetical;
 * it is the first thing that breaks.
 */

/**
 * @typedef {object} TreeIn
 * @property {number[][]} kids   kids[i] = ordinals of i's children, in draw order
 * @property {number[]} roots
 * @property {number[]} depth
 */

/**
 * @typedef {object} Layout
 * @property {Float64Array} x
 * @property {Float64Array} y
 * @property {number} minX @property {number} maxX
 * @property {number} minY @property {number} maxY
 * @property {number} nodeW @property {number} nodeH
 */

/**
 * @param {TreeIn} tree
 * @param {number} nodeW  node width, uniform (sized from the widest label in
 *                        the WHOLE tree, so nothing ever resizes)
 * @param {number} nodeH
 * @param {number} [gapX]  gap between adjacent siblings
 * @param {number} [gapY]  vertical gap between levels
 * @returns {Layout}
 */
export function tidyTree(tree, nodeW, nodeH, gapX = 14, gapY = 30) {
  const n = tree.kids.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  if (n === 0) {
    return { x, y, minX: 0, maxX: 0, minY: 0, maxY: 0, nodeW, nodeH };
  }

  const distance = nodeW + gapX;
  const levelH = nodeH + gapY;

  // Arrays indexed by ordinal, not objects with pointers: a call tree can be
  // 10k nodes and array-of-struct beats struct-of-pointer here by a wide margin.
  const prelim = new Float64Array(n);
  const mod = new Float64Array(n);
  const shift = new Float64Array(n);
  const change = new Float64Array(n);
  const thread = new Int32Array(n).fill(-1);
  const ancestor = new Int32Array(n);
  const parent = new Int32Array(n).fill(-1);
  const number = new Int32Array(n); // index among siblings, 1-based
  const kids = tree.kids;

  for (let v = 0; v < n; v++) {
    ancestor[v] = v;
    const ks = kids[v];
    for (let i = 0; i < ks.length; i++) {
      parent[ks[i]] = v;
      number[ks[i]] = i + 1;
    }
  }
  for (const r of tree.roots) number[r] = 1;

  const leftSibling = (v) => {
    const p = parent[v];
    if (p < 0) {
      const i = tree.roots.indexOf(v);
      return i > 0 ? tree.roots[i - 1] : -1;
    }
    const i = number[v] - 1;
    return i > 0 ? kids[p][i - 1] : -1;
  };
  const leftmostSibling = (v) => {
    const p = parent[v];
    if (p < 0) return tree.roots.length ? tree.roots[0] : -1;
    return kids[p][0];
  };
  const nextLeft = (v) => (kids[v].length ? kids[v][0] : thread[v]);
  const nextRight = (v) => (kids[v].length ? kids[v][kids[v].length - 1] : thread[v]);

  function moveSubtree(wm, wp, s) {
    const subtrees = number[wp] - number[wm];
    if (subtrees === 0) return;
    change[wp] -= s / subtrees;
    shift[wp] += s;
    change[wm] += s / subtrees;
    prelim[wp] += s;
    mod[wp] += s;
  }

  function executeShifts(v) {
    let sh = 0, ch = 0;
    const ks = kids[v];
    for (let i = ks.length - 1; i >= 0; i--) {
      const w = ks[i];
      prelim[w] += sh;
      mod[w] += sh;
      ch += change[w];
      sh += shift[w] + ch;
    }
  }

  function ancestorOf(vim, v, defaultAncestor) {
    return parent[ancestor[vim]] === parent[v] ? ancestor[vim] : defaultAncestor;
  }

  // The hard part. It walks the left and right CONTOURS of adjacent subtrees
  // using thread pointers, and distributes any required shift across the
  // intervening siblings so spacing stays even. Follow the paper.
  function apportion(v, defaultAncestor) {
    const w = leftSibling(v);
    if (w < 0) return defaultAncestor;

    let vip = v, vop = v, vim = w, vom = leftmostSibling(vip);
    let sip = mod[vip], sop = mod[vop], sim = mod[vim], som = mod[vom];

    while (nextRight(vim) >= 0 && nextLeft(vip) >= 0) {
      vim = nextRight(vim);
      vip = nextLeft(vip);
      vom = nextLeft(vom);
      vop = nextRight(vop);
      ancestor[vop] = v;
      const s = prelim[vim] + sim - (prelim[vip] + sip) + distance;
      if (s > 0) {
        moveSubtree(ancestorOf(vim, v, defaultAncestor), v, s);
        sip += s;
        sop += s;
      }
      sim += mod[vim];
      sip += mod[vip];
      som += mod[vom];
      sop += mod[vop];
    }
    if (nextRight(vim) >= 0 && nextRight(vop) < 0) {
      thread[vop] = nextRight(vim);
      mod[vop] += sim - sop;
    }
    if (nextLeft(vip) >= 0 && nextLeft(vom) < 0) {
      thread[vom] = nextLeft(vip);
      mod[vom] += sip - som;
      defaultAncestor = v;
    }
    return defaultAncestor;
  }

  // --- first walk, iterative post-order -------------------------------------
  // `i` is the next child to descend into; `done` is how many children have had
  // apportion applied. Keeping them separate is what lets apportion run
  // immediately after each child's own first walk, exactly as the recursive
  // formulation does.
  function firstWalk(root) {
    const stack = [{ v: root, i: 0, done: 0, da: kids[root].length ? kids[root][0] : root }];
    while (stack.length) {
      const f = stack[stack.length - 1];
      const v = f.v;
      const ks = kids[v];

      if (f.done < f.i) {
        f.da = apportion(ks[f.done], f.da);
        f.done++;
        continue;
      }
      if (f.i < ks.length) {
        const c = ks[f.i];
        f.i++;
        stack.push({ v: c, i: 0, done: 0, da: kids[c].length ? kids[c][0] : c });
        continue;
      }

      if (ks.length === 0) {
        const w = leftSibling(v);
        prelim[v] = w >= 0 ? prelim[w] + distance : 0;
      } else {
        executeShifts(v);
        const midpoint = (prelim[ks[0]] + prelim[ks[ks.length - 1]]) / 2;
        const w = leftSibling(v);
        if (w >= 0) {
          prelim[v] = prelim[w] + distance;
          mod[v] = prelim[v] - midpoint;
        } else {
          prelim[v] = midpoint;
        }
      }
      stack.pop();
    }
  }

  // --- second walk, iterative pre-order -------------------------------------
  function secondWalk(root, m, depth) {
    const stack = [{ v: root, m, d: depth }];
    while (stack.length) {
      const { v, m: mm, d } = stack.pop();
      x[v] = prelim[v] + mm;
      y[v] = d * levelH;
      const ks = kids[v];
      for (let i = ks.length - 1; i >= 0; i--) stack.push({ v: ks[i], m: mm + mod[v], d: d + 1 });
    }
  }

  // A forest is laid out root by root, each placed to the right of the previous
  // one's bounding box.
  let offset = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const r of tree.roots) {
    firstWalk(r);
    secondWalk(r, -prelim[r] + offset, 0);
    let lo = Infinity, hi = -Infinity;
    forEachInSubtree(kids, r, (v) => {
      if (x[v] < lo) lo = x[v];
      if (x[v] > hi) hi = x[v];
      if (x[v] < minX) minX = x[v];
      if (x[v] > maxX) maxX = x[v];
      if (y[v] < minY) minY = y[v];
      if (y[v] > maxY) maxY = y[v];
    });
    offset = hi + distance * 2;
  }
  if (!Number.isFinite(minX)) { minX = maxX = minY = maxY = 0; }

  return { x, y, minX, maxX, minY, maxY, nodeW, nodeH };
}

function forEachInSubtree(kids, root, fn) {
  const stack = [root];
  while (stack.length) {
    const v = stack.pop();
    fn(v);
    const ks = kids[v];
    for (let i = ks.length - 1; i >= 0; i--) stack.push(ks[i]);
  }
}
