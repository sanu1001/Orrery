// @ts-check
import { useMemo, useState } from 'react';
import { MODELS, agrees, fitGrowth } from '../lib/complexity.js';

const W = 300, H = 104, PAD_L = 6, PAD_R = 46, PAD_T = 8, PAD_B = 16;

/** Keep a label baseline inside the box. */
const clamp = (v) => Math.max(PAD_T + 2, Math.min(H - PAD_B - 2, v));

/**
 * Measured complexity beside the declared one.
 *
 * The counts come from `complexity.json`, generated at build time by
 * `orrery complexity` -- the browser cannot run Go, so the measuring happens
 * where the algorithms do and ships as static JSON, same as the traces. The
 * FITTING happens here, next to the chart that draws it.
 *
 * ONE HUE, two line styles. The fitted model is not a second series; it is an
 * annotation of the same quantity, so giving it its own colour would claim a
 * distinction that is not there. It also fails: `--settled` against
 * `--text-mute` measures ΔE 14.1 in light mode, under the 15 floor at which
 * full-colour readers stop being able to tell two marks apart. Dash and weight
 * carry the difference instead, which no amount of colour vision is required to
 * see.
 */
export default function ComplexityPane({ algo, data }) {
  const [key, setKey] = useState(/** @type {'steps'|'events'|'calls'} */('steps'));
  const entry = data?.[algo] ?? null;
  const fit = useMemo(() => fitGrowth(entry?.points ?? [], key), [entry, key]);

  if (!entry || (entry.points ?? []).length < 4) return null;

  const { best } = fit;
  const ok = agrees(entry.declared, best);
  const pts = entry.points;
  const ys = pts.map((p) => p[key]);
  const maxY = Math.max(...ys, 1);
  const minN = pts[0].n, maxN = pts[pts.length - 1].n;

  const x = (n) => PAD_L + ((n - minN) / Math.max(1, maxN - minN)) * (W - PAD_L - PAD_R);
  const y = (v) => H - PAD_B - (v / maxY) * (H - PAD_T - PAD_B);

  const line = pts.map((p) => `${x(p.n)},${y(p[key])}`).join(' ');
  const model = best ? modelPath(best, minN, maxN, x, y, maxY) : '';

  // The two direct labels are nudged apart when they would collide -- which is
  // exactly when the fit is GOOD, because then the model ends where the data
  // ends. Anchoring each to its own curve and hoping is how a chart ends up
  // with one label written over another at precisely the moments worth reading.
  const yEnd = y(ys[ys.length - 1]);
  let labMeasured = yEnd;
  let labFitted = model ? y(Math.min(predict(best, maxN, maxY), maxY)) : 0;
  if (model && Math.abs(labMeasured - labFitted) < 11) {
    labMeasured = clamp(yEnd - 6);
    labFitted = clamp(yEnd + 7);
  }

  return (
    <>
      <div className="section-head">
        Complexity
        <span style={{ marginLeft: 'auto', textTransform: 'none' }}>
          measured over {entry.sweep.join(' + ')}
        </span>
      </div>

      <div className="cx">
        <div className="cx-verdict">
          <span className="cx-row">
            <span className="k">declared</span>
            <span className="mono v">{pretty(entry.declared)}</span>
          </span>
          <span className="cx-row">
            <span className="k">measured</span>
            <span className="mono v" data-agree={ok === null ? '' : String(ok)}>
              {best ? best.name : 'no clean fit'}
            </span>
            {best && <span className="q">fit {best.quality.toFixed(2)}</span>}
          </span>
        </div>

        {/* A verdict, not a decoration: these two lines are the whole feature,
            and they are worth saying in words because a chart cannot say
            "these disagree, and here is the likely reason". */}
        {ok === false && (
          <p className="cx-note">
            The declared bound is an upper bound; the measurement is what this
            implementation did on this input distribution.
          </p>
        )}
        {ok === null && (
          <p className="cx-note">
            Cost does not grow smoothly with n here, so no model describes it —
            which is itself the finding.
          </p>
        )}

        <svg className="cx-chart" viewBox={`0 0 ${W} ${H}`} role="img"
             aria-label={`${key} against n for ${algo}: ` +
               pts.map((p) => `n ${p.n}, ${p[key]}`).join('; ')}>
          <title>{`${key} vs n`}</title>
          <line className="ax" x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} />

          {model && <path className="cx-model" d={model} />}
          <polyline className="cx-measured" points={line} />
          {pts.map((p) => (
            <circle key={p.n} className="cx-dot" cx={x(p.n)} cy={y(p[key])} r={4}>
              <title>{`n = ${p.n}: ${p[key]} ${key}`}</title>
            </circle>
          ))}

          {/* Direct labels rather than a colour legend, in TEXT tokens: the
              marks carry no identity by hue, so nothing is encoded in colour
              that a label is not already saying. */}
          <text className="cx-lab" x={W - PAD_R + 6} y={labMeasured + 3}>measured</text>
          {model && (
            <text className="cx-lab dim" x={W - PAD_R + 6} y={labFitted + 3}>fitted</text>
          )}
          <text className="cx-ax" x={PAD_L} y={H - 4}>n={minN}</text>
          <text className="cx-ax" x={W - PAD_R} y={H - 4} textAnchor="end">n={maxN}</text>
        </svg>

        <div className="seg" role="group" aria-label="what to count">
          {['steps', 'events', 'calls'].map((k) => (
            <button key={k} aria-pressed={key === k} onClick={() => setKey(k)}>{k}</button>
          ))}
        </div>
        {/* Which count you pick changes the answer, and that is worth noticing
            rather than hiding behind a single default. Binary search measures
            O(n) by events and O(log n) by steps: the events include loading the
            input array, which is n writes the search itself never performs. */}
      </div>
    </>
  );
}

/** The fitted curve, sampled densely enough to look like a curve. */
function modelPath(best, minN, maxN, x, y, maxY) {
  const out = [];
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const n = minN + ((maxN - minN) * i) / steps;
    out.push(`${i === 0 ? 'M' : 'L'} ${x(n)} ${y(Math.min(predict(best, n, maxY), maxY))}`);
  }
  return out.join(' ');
}

function predict(best, n, maxY) {
  if (!best) return 0;
  if (best.exponential) return Math.min(best.a * best.base ** n, maxY);
  const m = MODELS.find((x) => x.name === best.name);
  return m ? Math.max(0, best.a * m.f(n) + best.b) : 0;
}

/** `O(n^2)` from a Go struct, rendered the way the model list writes it. */
const pretty = (s) => String(s ?? '').replace(/\^2/g, '²').replace(/\^3/g, '³').replace(/\^n/g, 'ⁿ');
