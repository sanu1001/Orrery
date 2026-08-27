// @ts-check
/**
 * family -> component.
 *
 * An UNKNOWN family falls back to the text renderer rather than erroring.
 * That is required by the additive-change policy (ADR 0019): a trace produced
 * by a newer engine, naming a renderer this build has never heard of, must
 * still show something useful.
 */

import Fallback from './Fallback.jsx';
import Linear from './Linear.jsx';
import Grid from './Grid.jsx';
import RecursionTree from './RecursionTree.jsx';
import TreeView from './TreeView.jsx';
import LinkedList from './LinkedList.jsx';
import GraphView from './GraphView.jsx';

export const FAMILIES = {
  fallback: Fallback,
  linear: Linear,
  grid: Grid,
  recursionTree: RecursionTree,
  tree: TreeView,
  linkedList: LinkedList,
  graph: GraphView,
};

/** @param {string} family */
export function rendererFor(family) {
  return FAMILIES[family] ?? Fallback;
}

/** Families that are specified but not built yet, so the pane can say so
 *  honestly instead of silently degrading. */
export const PLANNED = new Set(['callStack']);

/**
 * Fallback family selection when meta.views is absent.
 *
 * Deliberately mediocre: it exists so a trace with no hints still shows
 * something reasonable. Built-in algorithms always declare views explicitly,
 * because inference cannot get the interesting cases right -- an adjacency
 * matrix is kind:"grid" and wants the graph renderer, a binary heap is
 * kind:"array" and wants a tree. Any inference good enough to fix those would
 * have to consult the algorithm name, which is exactly the coupling invariant
 * I2 forbids. ADR 0012.
 *
 * @param {object} init the init event
 * @returns {string}
 */
export function defaultFamily(init) {
  switch (init.kind) {
    case 'array': return 'linear';
    case 'grid': return 'grid';
    case 'map': return 'linear';
    case 'scalar': return 'fallback'; // scalars render as cursor chips, not panes
    case 'nodes': {
      const ptrs = Object.values(init.schema?.fields ?? {}).filter((k) => k === 'ptr').length;
      return ptrs === 1 ? 'linkedList' : ptrs === 2 ? 'tree' : 'graph';
    }
    case 'graph': return 'graph';
    default: return 'fallback';
  }
}

/**
 * Build the pane list for a trace: explicit hints if present, otherwise the
 * fallback table. Scalars are excluded because they render as cursor chips
 * attached to the structure they index, not as panes of their own.
 */
export function resolveViews(trace) {
  const declared = (trace?.meta?.views ?? []).filter((v) => v.pane !== 'side');
  if (declared.length > 0) return declared.slice(0, 2);

  const out = [];
  for (const e of trace?.events ?? []) {
    if (e.t !== 'init' || e.aux || e.kind === 'scalar') continue;
    out.push({ family: defaultFamily(e), s: e.s, pane: out.length, title: e.s });
    if (out.length === 2) break;
  }
  if (out.length === 0 && (trace?.events ?? []).some((e) => e.t === 'call')) {
    out.push({ family: 'recursionTree', s: '$calls', pane: 0, title: 'call tree' });
  }
  return out;
}
