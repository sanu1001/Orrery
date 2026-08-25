// @ts-check
/**
 * The shared cursor chip.
 *
 * One component, used by Linear, Grid and (later) the node renderers. It is the
 * main reason the families feel like one product rather than five: a violet
 * labelled chip means "a pointer is here" everywhere, so a user who learns the
 * array can read the graph without being taught.
 *
 * The chips exist because of CURSOR STRUCTURES -- aux scalars the algorithm
 * writes purely to make a read visible. ARCHITECTURE.md 6.1.
 */
export default function CursorChip({ name, index, cellW, stack = 0, parked = false, animate = true }) {
  const x = parked ? Math.max(0, index) * (cellW + 4) : index * (cellW + 4);
  return (
    <span
      className={`chip stack${stack}`}
      data-parked={parked ? 1 : 0}
      style={{
        '--x': `${x}px`,
        transitionDuration: animate ? undefined : '0ms',
      }}
      title={parked ? `${name} = ${index} (outside the array)` : `${name} = ${index}`}
    >
      {name}{parked ? ` = ${index}` : ''}
    </span>
  );
}

/**
 * Resolve which aux scalars point into this structure, and where.
 *
 * `options.cursors` names scalar structures whose value is an index into this
 * one. Two chips landing on the same index stack vertically instead of
 * overlapping -- which is exactly what happens the moment Floyd's slow and fast
 * pointers meet, so it is not a hypothetical.
 *
 * @param {import('../player/store.js').PlayerStore} store
 * @param {string[]} names
 * @param {number} length
 */
export function resolveCursors(store, names, length) {
  const out = [];
  const seen = new Map();
  for (const name of names ?? []) {
    const s = store.struct(name);
    if (!s) continue;
    const v = s.get([]);
    if (typeof v !== 'number') continue;
    const parked = v < 0 || v >= length;
    const key = String(v);
    const stack = seen.get(key) ?? 0;
    seen.set(key, stack + 1);
    out.push({ name, index: v, parked, stack: Math.min(stack, 2) });
  }
  return out;
}
