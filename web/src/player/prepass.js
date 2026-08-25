// @ts-check
/**
 * The pre-pass: one O(events) scan at load that produces every index the rest
 * of the app needs.
 *
 * This is where the project's biggest structural idea lives. Because the trace
 * is COMPLETE before the first frame is drawn, layout is a batch problem rather
 * than an online one -- so `structUnion` below is what lets trees and graphs be
 * laid out once and never move. ARCHITECTURE.md 5, ADR 0006.
 *
 * COST: this is on the critical path and is the memory high-water mark of the
 * app. `stats.ms` is measured every run and printed by the dev build. If it
 * ever exceeds ~100ms, split it (steps + lineIndex first, the rest one frame
 * later) before reaching for a Worker. FLAWS.md 10.
 */

import { addrKey, fmtValue } from '../lib/value.js';
import { buildSteps } from './steps.js';

/**
 * @typedef {object} CallNode
 * @property {number} id        the CALL event's index -- the stable identity.
 *                              Not stored in the trace; derived here, because
 *                              an index is gapless, monotonic and free.
 * @property {number} ord       dense ordinal into nodes[]
 * @property {number} parent    ordinal, -1 for a root
 * @property {number[]} kids
 * @property {number} depth
 * @property {string} fn
 * @property {Array<{n:string,v:*}>} args
 * @property {number} retEvent  matching ret's index, -1 if truncated mid-flight
 * @property {*} retValue
 * @property {number} memoSrc   ordinal this call cited via memo, else -1
 * @property {boolean} isMemoHit
 */

/**
 * @typedef {object} Index
 * @property {import('./steps.js').Step[]} steps
 * @property {Map<string, number>} firstWrite  addrKey -> first writing event index
 * @property {{nodes: CallNode[], byEvent: Map<number,number>, roots: number[], maxDepth: number}} callTree
 * @property {Map<string, object>} structUnion
 * @property {Map<number, number[]>} lineIndex source line -> step indices
 * @property {object} stats
 */

/**
 * @param {object} trace
 * @param {number} level
 * @returns {Index}
 */
export function buildIndex(trace, level = 0) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const events = trace.events;

  const steps = buildSteps(events, level);

  /** @type {Map<string, number>} */
  const firstWrite = new Map();
  /** @type {Map<string, object>} */
  const structUnion = new Map();
  /** @type {CallNode[]} */
  const nodes = [];
  /** @type {Map<number, number>} */
  const byEvent = new Map();
  const roots = [];
  const stack = [];
  let maxDepth = 0;
  let sets = 0;

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    switch (e.t) {
      case 'init':
        structUnion.set(e.s, {
          kind: e.kind,
          dims: e.dims ?? null,
          fill: e.fill ?? null,
          aux: !!e.aux,
          schema: e.schema ?? null,
          labels: e.labels ?? null,
          initEvent: i,
          keys: new Set(),
          nodeIds: [],
          edges: [],       // [fromId, ptrField, toId]
          maxValueWidth: 1,
        });
        break;

      case 'set': {
        sets++;
        const at = e.at ?? [];
        const key = addrKey(e.s, at);
        if (!firstWrite.has(key)) firstWrite.set(key, i);

        const u = structUnion.get(e.s);
        if (u) {
          u.keys.add(at.join('/'));
          // Union of everything that will EVER exist -- the input to every
          // layout function, which is why nothing ever has to move.
          if (u.kind === 'nodes' || u.kind === 'graph') {
            const head = String(at[0]);
            if (head !== '$refs' && head !== '$edges' && !u.nodeIds.includes(head)) {
              u.nodeIds.push(head);
            }
            if (at.length === 2 && head !== '$refs' && head !== '$edges') {
              const field = String(at[1]);
              if (u.schema?.fields?.[field] === 'ptr' && e.to && typeof e.to.$ === 'string') {
                u.edges.push([head, field, e.to.$]);
              }
            }
          }
          // Cell width is sized from the union, never from current state, so a
          // cell going from 9 to 1000 does not resize the whole row mid-run.
          const w = fmtValue(e.to).length;
          if (w > u.maxValueWidth) u.maxValueWidth = w;
        }
        break;
      }

      case 'call': {
        const ord = nodes.length;
        const parent = stack.length ? stack[stack.length - 1] : -1;
        const depth = parent >= 0 ? nodes[parent].depth + 1 : 0;
        if (depth > maxDepth) maxDepth = depth;
        const node = {
          id: i, ord, parent, kids: [], depth,
          fn: e.fn ?? '', args: e.args ?? [],
          retEvent: -1, retValue: undefined, memoSrc: -1, isMemoHit: false,
        };
        nodes.push(node);
        byEvent.set(i, ord);
        if (parent >= 0) nodes[parent].kids.push(ord);
        else roots.push(ord);
        stack.push(ord);
        break;
      }

      case 'ret': {
        const ord = stack.pop();
        if (ord === undefined) break;
        const node = nodes[ord];
        node.retEvent = i;
        node.retValue = e.v ?? null;
        // A MEMO HIT is recognised STRUCTURALLY: a call with no children whose
        // ret carries deps into some other structure. Nothing in the trace says
        // "this is a memo hit" -- deriving it is what keeps renderer purity
        // (I2) intact while still supporting the flagship. ADR 0005.
        if (node.kids.length === 0 && Array.isArray(e.deps) && e.deps.length > 0) {
          node.isMemoHit = true;
          const d = e.deps[0];
          const src = firstWrite.get(addrKey(d.s, d.at ?? []));
          if (src !== undefined) node.memoSrc = enclosingOrdinal(nodes, byEvent, src);
        }
        break;
      }
    }
  }

  // line -> steps, for click-a-line-to-jump.
  /** @type {Map<number, number[]>} */
  const lineIndex = new Map();
  for (let k = 0; k < steps.length; k++) {
    const ln = steps[k].ln;
    if (!ln) continue;
    const arr = lineIndex.get(ln);
    if (arr) arr.push(k);
    else lineIndex.set(ln, [k]);
  }

  const t1 = typeof performance !== 'undefined' ? performance.now() : 0;
  return {
    steps, firstWrite,
    callTree: { nodes, byEvent, roots, maxDepth },
    structUnion, lineIndex,
    stats: {
      events: events.length, sets, calls: nodes.length,
      steps: steps.length, maxDepth, ms: t1 - t0,
    },
  };
}

/**
 * The innermost call whose [call, ret) range contains eventIdx.
 *
 * Linear scan backwards from the event, which is fine because it runs once per
 * memo hit during the pre-pass rather than per frame. The binary search over
 * call ranges described in RENDERERS/RECURSION_TREE.md is the upgrade if a
 * trace ever has enough memo hits for this to show up in a profile.
 */
function enclosingOrdinal(nodes, byEvent, eventIdx) {
  for (let ord = nodes.length - 1; ord >= 0; ord--) {
    const n = nodes[ord];
    if (n.id <= eventIdx && (n.retEvent === -1 || n.retEvent > eventIdx)) return ord;
  }
  return -1;
}

/**
 * The set of grid/array/map cells written inside a call node's event range.
 * Used for the tree-node -> grid-cell direction of cross-pane focus.
 * @returns {string[]} address keys
 */
export function cellsWrittenIn(trace, node, structName) {
  if (!node) return [];
  const end = node.retEvent === -1 ? trace.events.length : node.retEvent;
  const out = [];
  for (let i = node.id; i <= end && i < trace.events.length; i++) {
    const e = trace.events[i];
    if (e.t === 'set' && e.s === structName) out.push(addrKey(e.s, e.at ?? []));
  }
  return out;
}
