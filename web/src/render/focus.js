// @ts-check
/**
 * The focus protocol: the only channel between panes.
 *
 * There is no synchronization problem here -- both panes are pure functions of
 * the same store, so they cannot drift. What DOES need building is the
 * translation between the two coordinate systems, in both directions:
 *
 *   grid cell  -> the call that computed it
 *   call node  -> the cells it wrote
 *   memo hit   -> the node that originally computed the value it cites
 *
 * All three are cheap because the pre-pass already built the indexes:
 * `firstWrite` maps an address to the event that wrote it, and the call tree
 * carries each node's [call, ret) range. This module is about sixty lines and
 * it is the single most convincing interaction in the demo, because it makes
 * the equivalence between the recursion and the table VISIBLE rather than
 * asserted. FRONTEND.md 8.2.
 */

import { addrKey } from '../lib/value.js';

/**
 * @typedef {{kind:'cell', s:string, at:Array<number|string>}
 *         | {kind:'call', event:number, ord?:number}
 *         | null} Focus
 */

/**
 * @typedef {object} Resolved
 * @property {Set<string>} cells  address keys to highlight
 * @property {Set<number>} ords   call-tree ordinals to highlight
 */

const EMPTY = { cells: new Set(), ords: new Set() };

/**
 * @param {import('../player/store.js').PlayerStore} store
 * @param {Focus} focus
 * @returns {Resolved}
 */
export function resolveFocus(store, focus) {
  if (!store || !focus) return EMPTY;
  const tree = store.index.callTree;

  if (focus.kind === 'call') {
    const ord = focus.ord ?? tree.byEvent.get(focus.event);
    if (ord === undefined) return EMPTY;
    const ords = new Set([ord]);
    // A memo hit also lights up the node that originally computed the value --
    // that pairing is the whole point of the flagship.
    const src = tree.nodes[ord].memoSrc;
    if (src >= 0) ords.add(src);
    return { cells: cellsWrittenIn(store, tree.nodes[ord]), ords };
  }

  if (focus.kind === 'cell') {
    const key = addrKey(focus.s, focus.at ?? []);
    const ev = store.index.firstWrite.get(key);
    const cells = new Set([key]);
    if (ev === undefined) return { cells, ords: new Set() };
    const ord = enclosingCall(tree, ev);
    return { cells, ords: ord >= 0 ? new Set([ord]) : new Set() };
  }

  return EMPTY;
}

/**
 * Non-aux cells written inside a call's [call, ret) range.
 *
 * Capped, because a root call's range is the whole trace and highlighting every
 * cell it ever touched says nothing. Twelve is enough to show the shape.
 */
function cellsWrittenIn(store, node, cap = 12) {
  const out = new Set();
  if (!node) return out;
  const events = store.trace.events;
  const end = node.retEvent < 0 ? events.length : node.retEvent;
  for (let i = node.id; i <= end && i < events.length && out.size < cap; i++) {
    const e = events[i];
    if (e.t !== 'set') continue;
    if (store.struct(e.s)?.aux) continue;
    out.add(addrKey(e.s, e.at ?? []));
  }
  return out;
}

/**
 * The innermost call whose [call, ret) range contains an event.
 *
 * Linear scan backwards. It runs once per hover, not per frame, so the binary
 * search over call ranges described in RENDERERS/RECURSION_TREE.md 8 is an
 * upgrade to make only if a profile ever shows this.
 */
export function enclosingCall(tree, eventIdx) {
  for (let ord = tree.nodes.length - 1; ord >= 0; ord--) {
    const n = tree.nodes[ord];
    if (n.id <= eventIdx && (n.retEvent === -1 || n.retEvent > eventIdx)) return ord;
  }
  return -1;
}
