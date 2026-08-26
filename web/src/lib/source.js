// @ts-check
/**
 * Source-pane structure: which lines are prologue, and how hot each line is.
 *
 * The redesign's first observation is measurable rather than aesthetic --
 * twelve of the first twenty-three lines of a typical algorithm file are
 * `package` and `import`, so the function you opened the pane to read starts
 * below the fold. This module finds that prologue so the pane can collapse it
 * to one pill.
 *
 * It keys off `meta.lang`, never `meta.algo`. Language is a property of the
 * SOURCE and folding is a property of the language; branching on the algorithm
 * would put algorithm knowledge in a consumer, which is invariant I2 and the
 * reason an eighteenth algorithm costs one Go file and no frontend change.
 */

/**
 * @typedef {object} Fold
 * @property {number} from   first source line of the range, inclusive
 * @property {number} to     last source line, inclusive
 * @property {string} label  what the collapsed pill reads
 */

/**
 * Foldable prologue ranges, in SOURCE line numbers (already offset by
 * firstLine, so they compare directly against an event's `ln`).
 *
 * Only the prologue is folded, never the body. A fold that can hide the line an
 * event points at would make the code pane lie about where execution is, and
 * the pane's whole justification is that `ln` puts execution on screen.
 *
 * @param {string} text
 * @param {string} lang
 * @param {number} [firstLine]
 * @returns {Fold[]}
 */
export function foldableRanges(text, lang, firstLine = 1) {
  if (!text) return [];
  if (lang !== 'go') return []; // C++ arrives with Stage C; fixtures have no prologue
  const lines = text.split('\n');
  const folds = [];

  let i = 0;
  const at = (k) => (lines[k] ?? '').trim();

  // `package x` plus any blank lines under it.
  if (at(0).startsWith('package ')) {
    let end = 0;
    while (end + 1 < lines.length && at(end + 1) === '') end++;
    // Only worth a pill if an import block follows; a lone package line folded
    // to a pill saves nothing and costs a click.
    if (at(end + 1).startsWith('import')) i = end + 1;
  }

  if (at(i).startsWith('import (')) {
    let end = i;
    while (end < lines.length && at(end) !== ')') end++;
    if (end < lines.length) {
      const n = countImports(lines.slice(i, end + 1));
      const stop = absorbInit(lines, absorbEmbed(lines, end, at), at);
      folds.push({ from: firstLine, to: firstLine + stop.end, label: pill(n, stop.init) });
    }
  } else if (at(i).startsWith('import ')) {
    // Consecutive single-line imports.
    let end = i;
    while (end + 1 < lines.length && at(end + 1).startsWith('import ')) end++;
    folds.push({ from: firstLine, to: firstLine + end, label: pill(end - i + 1) });
  }

  // The registration block, wherever it sits.
  //
  // absorbInit only reaches an init() that directly follows the imports, and
  // several algorithms declare a const between the two -- coins-memo has its
  // noSolution sentinel there, which is real code and must stay visible. So
  // init is also folded on its own, as a second pill, when it was not already
  // swallowed by the first.
  const initAt = topLevelInit(lines);
  if (initAt >= 0 && !folds.some((f) => firstLine + initAt <= f.to)) {
    const end = blockEnd(lines, initAt);
    if (end > initAt) {
      folds.push({
        from: firstLine + initAt,
        to: firstLine + end,
        label: 'the registration block',
      });
    }
  }

  return folds;
}

/** Index of a top-level `func init() {`, or -1. */
function topLevelInit(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (/^func init\(\)\s*\{/.test(lines[i])) return i;
  }
  return -1;
}

/** Index of the line closing the brace opened on `start`, or start. */
function blockEnd(lines, start) {
  let depth = 0;
  for (let k = start; k < lines.length; k++) {
    for (const ch of lines[k]) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth === 0) return k;
  }
  return start;
}

/**
 * Extend a fold past the `//go:embed x.go` + `var xSrc string` pair that
 * follows the imports. It is the plumbing that puts this file INTO the code
 * pane -- maximally meta, and the one thing a reader of the algorithm never
 * needs. Folding only to the closing paren left it stranded at the top as two
 * orphan lines, which looked like a bug in the fold.
 *
 * Safe to hide because neither line can execute, so no event's `ln` points
 * into the range. `no fold hides a line an event points at` asserts that over
 * every golden rather than trusting the reasoning.
 */
function absorbEmbed(lines, end, at) {
  let k = end;
  while (k + 1 < lines.length && at(k + 1) === '') k++;
  if (!at(k + 1).startsWith('//go:embed')) return end;
  k++;
  if (at(k + 1).startsWith('var ')) k++;
  return k;
}

function countImports(block) {
  let n = 0;
  for (const raw of block) {
    const s = raw.trim();
    if (!s || s.startsWith('import') || s === ')') continue;
    n++;
  }
  return n;
}

/**
 * Extend the fold over a top-level `func init()`.
 *
 * In this codebase that block is always the registration -- ID, Title, Blurb,
 * the input specs with their help strings -- which is metadata about the
 * algorithm rather than the algorithm. It is also where the longest lines in
 * the file live, so in a rail it wrapped two and three deep and pushed the
 * function you opened the pane to read off the bottom.
 *
 * Safe for the same reason the //go:embed pair is: init runs before any trace
 * exists, so no event's `ln` points into it. Asserted over every golden rather
 * than argued -- see "no fold hides a line an event points at".
 *
 * Brace counting, not a parser: this only has to find the end of a block whose
 * shape gofmt already guarantees, and a brace inside a string would need a
 * literal "}" in a registration field to matter.
 */
function absorbInit(lines, end, at) {
  let k = end;
  while (k + 1 < lines.length && at(k + 1) === '') k++;
  if (!/^func init\(\)\s*\{/.test(at(k + 1))) return { end, init: false };
  k++;
  let depth = 0;
  for (; k < lines.length; k++) {
    for (const ch of lines[k]) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth === 0) return { end: k, init: true };
  }
  return { end, init: false };
}

function pill(n, withInit) {
  const imports = n === 1 ? '1 import' : `${n} imports`;
  return withInit ? `package, ${imports} and the registration` : `package and ${imports}`;
}

/**
 * How many steps run a given source line. The pre-pass already built
 * line -> steps to make lines clickable; the count was sitting in that index
 * unused, behind a tooltip. Showing it turns the gutter into a cheap profile:
 * a line with 40 hits in a 121-step trace is where the work is.
 *
 * @param {Map<number, number[]>|undefined} lineIndex
 * @param {number} ln
 * @returns {number}
 */
export function lineHits(lineIndex, ln, upToStep) {
  const steps = lineIndex?.get(ln);
  if (!steps) return 0;
  if (upToStep === undefined) return steps.length;
  // Counted AS THE TRACE RUNS, not over the whole trace. Showing the final
  // total from step 0 turns a live profile into a spoiler: every line already
  // wearing its finished count says nothing about where execution has been.
  // The array is built in step order, so this is a bisect, not a filter.
  let lo = 0, hi = steps.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (steps[mid] < upToStep) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * The busiest line's hit count, for scaling the gutter's heat. Returned rather
 * than assumed, because a 121-step backtracking trace and a 43-step DP fill
 * have hit counts an order of magnitude apart, and a fixed scale would render
 * one of them as a flat wall.
 *
 * @param {Map<number, number[]>|undefined} lineIndex
 * @returns {number}
 */
export function peakHits(lineIndex) {
  let max = 0;
  if (!lineIndex) return 0;
  for (const steps of lineIndex.values()) if (steps.length > max) max = steps.length;
  return max;
}
