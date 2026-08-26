// @ts-check
/**
 * Address families: the siblings of the address a step just wrote.
 *
 * This is the generic form of a panel the first redesign got wrong. It asked
 * for "Rows tried in column 3", which is N-Queens knowledge in a renderer and
 * so is invariant I2. The second pass found the general statement: wildcard one
 * index of the written address and list what sits beside it. That single rule
 * becomes the rows tried in a column, the cells filled so far in a DP row, or
 * every `.next` pointer in a list, without anything here knowing which it is.
 *
 * The design expressed it as a regex over a formatted label, `board[3][4]`.
 * Orrery does not have to: an address is already a structured path, so the
 * family is "same structure, same segments, one position free" -- no parsing,
 * and no way to be defeated by a node id that happens to contain a bracket.
 *
 * Which position is free is DERIVED, never guessed. Wildcarding the last
 * segment is right for a grid and wrong for a linked list, where the last
 * segment is the field name `next` and the varying one is the node before it.
 * So the axis is the last position at which the structure actually has other
 * addresses -- a fact the pre-pass already collected.
 */

/**
 * @typedef {object} Family
 * @property {number} axis     index into the path that varies
 * @property {Array<Array<number|string>>} members  sibling paths, in order
 */

/**
 * @param {string} s        structure name
 * @param {Array<number|string>} at  the written address
 * @param {Map<string, any>|undefined} structUnion
 * @returns {Family|null} null when the address has no siblings -- a scalar
 *                        cursor, or a structure with exactly one cell
 */
export function familyOf(s, at, structUnion) {
  if (!at || at.length === 0) return null;
  const u = structUnion?.get(s);
  if (!u) return null;

  const keys = u.keys instanceof Set ? [...u.keys] : [];
  const paths = keys.map((k) => k.split('/'));

  // Last position first: for a grid that is the column, for `L.n3.next` the
  // last position is the field name and holds no siblings, so the search falls
  // through to the node id -- which is the axis a reader of a list cares about.
  for (let axis = at.length - 1; axis >= 0; axis--) {
    const seen = siblingsAt(paths, at, axis);
    if (seen.length > 1) {
      return { axis, members: expand(u, at, axis, seen) };
    }
  }
  return null;
}

/**
 * Paths that match `at` everywhere except at `axis`, as the distinct values
 * that position takes. Compared as strings because a path segment arrives as a
 * number from a grid and as a string from the key index, and 3 and "3" are the
 * same cell.
 */
function siblingsAt(paths, at, axis) {
  const out = [];
  const seen = new Set();
  for (const p of paths) {
    if (p.length !== at.length) continue;
    let ok = true;
    for (let i = 0; i < at.length; i++) {
      if (i === axis) continue;
      if (String(p[i]) !== String(at[i])) { ok = false; break; }
    }
    if (!ok) continue;
    const v = p[axis];
    if (!seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

/**
 * Widen a family to the structure's full extent along that axis.
 *
 * `keys` holds only addresses that were ever WRITTEN, so on a grid it would
 * show a half-filled row that grows as the run proceeds. `dims` gives the whole
 * row up front, which is what lets the panel show the shape a run will fill
 * before it fills it -- the same reason layout runs on the union rather than on
 * current state.
 */
function expand(u, at, axis, seen) {
  const dims = u.dims;
  if (Array.isArray(dims) && axis < dims.length && Number.isFinite(dims[axis])) {
    const out = [];
    for (let k = 0; k < dims[axis]; k++) {
      const path = at.slice();
      path[axis] = k;
      out.push(path);
    }
    return out;
  }
  // No declared extent: a chain or a tree, where the members are exactly the
  // addresses that exist. Sorted numerically when they look like indices so
  // node[10] does not sort before node[2].
  const vals = seen.slice().sort(cmp);
  return vals.map((v) => {
    const path = at.slice();
    path[axis] = numeric(v) ? Number(v) : v;
    return path;
  });
}

function numeric(v) {
  return v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v));
}

function cmp(a, b) {
  if (numeric(a) && numeric(b)) return Number(a) - Number(b);
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/**
 * What one family member is, right now.
 *
 * Here rather than in the pane because this rule has been got wrong twice, in
 * two different files, in the same way: by reading the current VALUE instead of
 * the last WRITE.
 *
 * Both failures were silent and both looked plausible on screen.
 *   - `holds the fill` was taken to mean retracted. LCS writes 0 into cells
 *     whose fill is 0, legitimately, so a monotone DP fill reported as full of
 *     backtracking. The same mistake had already been made in player/density.js.
 *   - a pointer set to null was taken to mean retracted. `cur = nil` ends a
 *     list walk and a tail's `.next` is null because it is the tail; the
 *     reversal reported most of its steps as undoing.
 *
 * Retraction is a transition -- away from a real value, back to the fill -- and
 * pointers are exempt from it.
 *
 * @param {object} o
 * @param {{from:*, to:*}|undefined} o.write  last write at or before now
 * @param {*} o.fill
 * @param {boolean} o.pointer  the producer declared this address a pointer
 * @param {boolean} o.writtenNow  written by the current step
 * @param {boolean} o.readNow     read by the current step
 * @returns {'written'|'read'|'undone'|'settled'|'empty'}
 */
export function cellState({ write, fill, pointer, writtenNow, readNow }) {
  const everWritten = write !== undefined && write !== null;
  const retracted = everWritten
    && eq(write.to, fill) && !eq(write.from, fill) && !pointer;

  if (writtenNow) return retracted ? 'undone' : 'written';
  if (readNow) return 'read';
  if (everWritten) return retracted ? 'undone' : 'settled';
  return 'empty';
}

function eq(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  return a === b;
}

/**
 * A label for the family, with the free position marked. `board[3][·]`,
 * `L.·.next`. Middle dot rather than `*` or `?`, neither of which reads as
 * "any of these" so much as "something is missing".
 */
export function familyLabel(s, at, axis) {
  let out = s;
  for (let i = 0; i < at.length; i++) {
    const seg = i === axis ? '·' : at[i];
    out += typeof at[i] === 'number' || i === axis ? `[${seg}]` : `.${seg}`;
  }
  return out;
}
