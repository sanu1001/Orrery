// @ts-check
/**
 * Measured complexity: fit a growth curve to counts the trace already contains.
 *
 * The interesting thing is not the fit, it is the DISAGREEMENT. Every algorithm
 * declares a big-O in its spec; this fits a model to what it actually did at a
 * range of input sizes, and the two are shown together precisely because they
 * can differ. A claim nothing checks is decoration.
 *
 * No DOM, no React: tested in Node by scripts/player.test.mjs.
 *
 * @typedef {{n: number, events: number, steps: number, calls: number}} Point
 * @typedef {{name: string, a: number, err: number, quality: number}} Fit
 */

/**
 * The candidate models, in increasing order of growth.
 *
 * Deliberately a short fixed list rather than a general regression. These are
 * the shapes an algorithms course names, and the answer has to be one of them
 * to mean anything -- "n^1.87" is a better fit and a worse answer.
 *
 * `log2(n + 1)` rather than `log2(n)` so n = 1 contributes a finite non-zero
 * term instead of a zero that makes the whole model degenerate.
 */
export const MODELS = [
  { name: 'O(1)', f: () => 1 },
  { name: 'O(log n)', f: (n) => Math.log2(n + 1) },
  { name: 'O(n)', f: (n) => n },
  { name: 'O(n log n)', f: (n) => n * Math.log2(n + 1) },
  { name: 'O(n²)', f: (n) => n * n },
  { name: 'O(n³)', f: (n) => n * n * n },
  { name: 'O(2ⁿ)', f: (n) => 2 ** n },
];

/**
 * Above this mean relative error, no model is claimed at all.
 *
 * N-Queens is why the threshold exists. It stops at the first solution it
 * finds, so its cost swings wildly with n -- 31 events at n=4, 18 at n=5, 447
 * at n=8. Its best model misses by 127% on average, and reporting the least-bad
 * one as "the measured complexity" would be a confident answer to a question
 * the data cannot settle. Saying so is the more useful output.
 *
 * 40% rather than something tighter, because step counts on small inputs are
 * genuinely lumpy: bubble sort's swap count is the input's inversion count, so
 * one permutation at n=16 can cost less than another at n=13. It fits O(n^2) at
 * 0.334 -- a real quadratic that a 25% bar rejected. The gap to N-Queens is
 * still nearly fourfold, so the threshold separates "noisy" from "shapeless"
 * without having to be delicate. Marginal fits are not hidden either; the
 * quality figure is shown, so 0.67 reads as weaker than 1.00.
 */
export const INCONCLUSIVE = 0.40;

/**
 * An exponential fit is only claimed at or above this base, and only when it
 * beats the best polynomial by this margin. See the note at the fit itself.
 */
export const EXP_BASE_FLOOR = 1.15;
export const EXP_MARGIN = 0.75;

/**
 * Fit every model and rank them.
 *
 * The parameter is fitted to minimise RELATIVE error, not squared error. With
 * counts spanning 8 to 70,000 in one series, a least-squares fit is decided
 * almost entirely by the largest point and will call anything exponential;
 * scoring proportionally weighs a 10% miss at n=2 the same as a 10% miss at
 * n=20, which is what "does this curve have the right shape" actually means.
 *
 * @param {Point[]} points
 * @param {'events'|'steps'|'calls'} [key]
 * @returns {{best: Fit|null, ranked: Fit[]}}
 */
export function fitGrowth(points, key = 'events') {
  const data = (points ?? []).filter((p) => p && p.n > 0 && Number.isFinite(p[key]) && p[key] > 0);
  // Three points is the floor: two are fitted exactly by any two-parameter
  // model, so agreement would carry no information.
  if (data.length < 4) return { best: null, ranked: [] };

  const ys = data.map((p) => p[key]);
  const score = (pred) => data.reduce((s, p, i) => s + Math.abs(pred(p.n) / ys[i] - 1), 0) / data.length;

  const ranked = MODELS.map(({ name, f }) => {
    // TWO parameters, y ~= a*f(n) + b, not one.
    //
    // The intercept is what makes small n usable. Edit distance fills an
    // (n+1)x(n+1) table, so at n=1 it does 4 units of work where a pure a*n^2
    // model predicts a -- and a one-parameter fit, scored proportionally, is
    // dominated by exactly that early disagreement. It ranked a genuinely
    // quadratic algorithm as O(n log n). The constant absorbs the setup cost
    // every real implementation has and lets the SHAPE decide the answer.
    const { a, b } = lsq(data.map((p) => f(p.n)), ys);
    return { name, a, b, err: score((n) => a * f(n) + b) };
  });

  // Exponential growth is fitted in log space and reports the base it MEASURES.
  // Fibonacci's naive recursion grows as phi^n, about 1.62^n, so a fixed 2^n
  // model misses by a factor that compounds with n and the fit is refused --
  // correctly, and uselessly. The base is the interesting number anyway.
  const { a: lb, b: lm } = lsq(data.map((p) => p.n), ys.map(Math.log));
  const base = Math.exp(lb);
  const bestPoly = Math.min(...ranked.map((r) => r.err));
  if (Number.isFinite(base) && base >= EXP_BASE_FLOOR) {
    const k = Math.exp(lm);
    const err = score((n) => k * base ** n);
    // "Exponential" is the surprising claim, so it has to EARN the win rather
    // than merely edge it. A two-parameter curve in log space will fit almost
    // any monotone series somewhat well: bubble sort's step count came out as
    // O(1.14^n), which over n <= 32 is numerically fine and conceptually
    // nonsense. Requiring a clear margin over the best polynomial, and a base
    // far enough above 1 to be distinguishable from one at all, keeps the claim
    // for data that is actually exponential -- fib-naive, at 1.66.
    if (err < bestPoly * EXP_MARGIN) {
      ranked.push({
        name: `O(${round2(base)}ⁿ)`, a: k, b: 0, exponential: true, base, err,
      });
    }
  }

  ranked.sort((x, y) => x.err - y.err);
  for (const r of ranked) r.quality = Math.max(0, 1 - r.err);
  const best = ranked[0].err <= INCONCLUSIVE ? ranked[0] : null;
  return { best, ranked };
}

/** Ordinary least squares for y = a*x + b. */
function lsq(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const a = den === 0 ? 0 : num / den;
  return { a, b: my - a * mx };
}

const round2 = (v) => (Math.round(v * 100) / 100).toString();

/**
 * Do the measurement and the claim agree?
 *
 * Compared as normalised strings, because `O(n^2)` from a Go struct and `O(n²)`
 * from the model list are the same claim written twice. A mismatch is a real
 * finding rather than an error -- it means the declared bound is loose, the
 * input distribution is not the one the bound assumes, or the instrumentation
 * counts something other than the work the bound describes.
 *
 * @param {string} declared @param {Fit|null} best
 */
export function agrees(declared, best) {
  if (!best || !declared) return null;
  return norm(declared) === norm(best.name);
}

const norm = (s) => String(s)
  .replace(/\s+/g, '')
  .replace(/²/g, '^2').replace(/³/g, '^3').replace(/ⁿ/g, '^n')
  .toLowerCase();
