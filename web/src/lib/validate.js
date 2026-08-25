// @ts-check
/**
 * The trust boundary.
 *
 * Every trace is validated here before it reaches the player -- including ones
 * that arrive from the network or from a file the user dragged in. This is the
 * JavaScript twin of trace.Validate in Go, implementing the same V1..V14, and
 * it is the single place where "is this data shaped the way we think" is asked.
 *
 * Concentrating the check here is also what makes writing the rest of the
 * frontend in plain JavaScript defensible (ADR 0009): past this function the
 * shape is known-good, so the remaining risk is renderers misreading VALID
 * data -- a far smaller surface than "anything could be anything".
 *
 * It must never throw. A malformed trace produces diagnostics, not an
 * exception, because the UI renders those diagnostics.
 */

import { State } from '../player/state.js';
import { addrKey, canon, deepEqual } from './value.js';

export const SUPPORTED_MIN = 1;
export const SUPPORTED_MAX = 1;

/**
 * @typedef {{check:string, severity:'error'|'warning', event:number, message:string}} Diag
 */

const NODE_KINDS = new Set(['nodes', 'graph']);

/**
 * @param {*} trace
 * @returns {Diag[]}
 */
export function validate(trace) {
  /** @type {Diag[]} */
  const out = [];
  const add = (check, severity, event, message) => out.push({ check, severity, event, message });

  try {
    if (!trace || typeof trace !== 'object') {
      add('V1', 'error', -1, 'not a trace object');
      return out;
    }
    if (typeof trace.v !== 'number' || trace.v < SUPPORTED_MIN || trace.v > SUPPORTED_MAX) {
      add('V1', 'error', -1,
        `this trace is version ${trace.v}; this build reads versions ${SUPPORTED_MIN}–${SUPPORTED_MAX}`);
      return out;
    }
    if (!Array.isArray(trace.events)) {
      add('V1', 'error', -1, 'trace.events is missing or not an array');
      return out;
    }

    const decls = new Map();
    const aux = new Set();
    const written = new Set();
    const state = new State(trace);
    const initialHash = state.hash();

    let depth = 0;
    let prevG = 0;
    const seenG = new Set();
    const srcLines = trace.meta?.source?.text ? trace.meta.source.text.split('\n').length : 0;

    for (let i = 0; i < trace.events.length; i++) {
      const e = trace.events[i];
      if (!e || typeof e !== 'object') {
        add('V1', 'error', i, 'event is not an object');
        continue;
      }

      // V7 -- group ids form contiguous runs.
      const g = e.g ?? 0;
      if (g !== 0) {
        if (g !== prevG && seenG.has(g)) add('V7', 'error', i, `group id ${g} reappears after a gap`);
        seenG.add(g);
      }
      prevG = g;

      // V10 -- line within source bounds.
      if (e.ln && srcLines && e.ln > srcLines) {
        add('V10', 'warning', i, `ln ${e.ln} is past the end of meta.source.text (${srcLines} lines)`);
      }

      switch (e.t) {
        case 'init': {
          if (!e.s) { add('V2', 'error', i, 'init has no structure name'); continue; }
          if (decls.has(e.s)) { add('V2', 'error', i, `structure "${e.s}" initialised twice`); continue; }
          if (NODE_KINDS.has(e.kind) && !e.schema) {
            add('V3', 'error', i, `structure "${e.s}" is kind "${e.kind}" but declares no schema`);
          }
          if (e.kind === 'grid' && (!Array.isArray(e.dims) || e.dims.length !== 2)) {
            add('V3', 'error', i, `grid "${e.s}" needs dims [rows, cols]`);
          }
          if (e.kind === 'array' && (!Array.isArray(e.dims) || e.dims.length !== 1)) {
            add('V3', 'error', i, `array "${e.s}" needs dims [n]`);
          }
          decls.set(e.s, e);
          if (e.aux) aux.add(e.s);
          break;
        }
        case 'set': {
          const decl = decls.get(e.s);
          if (!decl) {
            add('V2', 'error', i, `set writes to "${e.s}", which was never initialised`);
            continue;
          }
          const at = e.at ?? [];
          const msg = checkAddr(decl, at);
          if (msg) add('V3', 'error', i, msg);

          // V12 -- reserved node id prefix.
          if (NODE_KINDS.has(decl.kind) && typeof at[0] === 'string' &&
              at[0].startsWith('$') && at[0] !== '$refs' && at[0] !== '$edges') {
            add('V12', 'error', i, `node id "${at[0]}" may not begin with '$'`);
          }
          // V8 -- detail levels only on aux structures.
          if ((e.lvl ?? 0) > 0 && !aux.has(e.s)) {
            add('V8', 'error', i,
              `lvl ${e.lvl} on "${e.s}", which is not declared aux — filtering it would corrupt replay`);
          }
          // V4 -- from matches current state. With V6 this is a complete proof
          // that the trace is a valid reversible delta log.
          const cur = state.get(e.s, at);
          if (!deepEqual(cur, e.from ?? null)) {
            add('V4', 'error', i,
              `from is ${canon(e.from ?? null)} but ${addrKey(e.s, at)} currently holds ${canon(cur)}`);
          }
          // V11 -- redundant no-op write, on a REPEAT only. A first write whose
          // value happens to equal the fill is a computed cell, not a bug.
          const key = addrKey(e.s, at);
          if (deepEqual(e.from ?? null, e.to ?? null) && written.has(key)) {
            add('V11', 'warning', i, `${key} is written again with the value it already has`);
          }
          written.add(key);
          break;
        }
        case 'call':
          depth++;
          break;
        case 'ret':
          depth--;
          if (depth < 0) { add('V5', 'error', i, 'ret with no open call'); depth = 0; }
          break;
        default:
          add('V1', 'error', i, `unknown event type "${e.t}"`);
      }

      // V9 -- deps refer to live structures.
      for (const d of e.deps ?? []) {
        const ds = decls.get(d.s);
        if (!ds) { add('V9', 'error', i, `dep refers to "${d.s}", which does not exist yet`); continue; }
        if (aux.has(d.s) && (e.lvl ?? 0) === 0 && !aux.has(e.s)) {
          add('V8', 'warning', i,
            `explanation cites aux structure "${d.s}", which is hidden at detail level 0`);
        }
        const m = checkAddr(ds, d.at ?? []);
        if (m) add('V9', 'error', i, `dep address: ${m}`);
      }

      state.forward(i, e, null);
    }

    if (depth > 0 && !trace.meta?.truncated) {
      add('V5', 'error', -1, `${depth} call(s) never returned in a trace that is not marked truncated`);
    }

    // V6 -- full backward replay returns to the initial state.
    for (let i = trace.events.length - 1; i >= 0; i--) state.backward(i, trace.events[i], null);
    if (state.hash() !== initialHash) {
      add('V6', 'error', -1,
        'state after a full forward-then-backward replay differs from the initial state');
    }

    // V13 -- view hints name real structures.
    for (const v of trace.meta?.views ?? []) {
      if (v.s === '$calls') continue;
      if (!decls.has(v.s)) {
        add('V13', 'warning', -1,
          `view "${v.family}" names structure "${v.s}", which the trace never creates`);
      }
    }
  } catch (err) {
    add('V0', 'error', -1, `validator threw: ${err && err.message} (this is a bug in Orrery)`);
  }
  return out;
}

/** @param {Diag[]} ds */
export function hasErrors(ds) {
  return ds.some((d) => d.severity === 'error');
}

function checkAddr(decl, at) {
  switch (decl.kind) {
    case 'scalar':
      if (at.length !== 0) return `scalar "${decl.s}" is addressed by [], got ${at.join('/')}`;
      break;
    case 'array':
      if (at.length !== 1 || typeof at[0] !== 'number') {
        return `array "${decl.s}" needs a single integer index, got "${at.join('/')}"`;
      }
      if (Array.isArray(decl.dims) && (at[0] < 0 || at[0] >= decl.dims[0])) {
        return `index ${at[0]} is outside array "${decl.s}" of length ${decl.dims[0]}`;
      }
      break;
    case 'grid':
      if (at.length !== 2 || typeof at[0] !== 'number' || typeof at[1] !== 'number') {
        return `grid "${decl.s}" needs two integer indices, got "${at.join('/')}"`;
      }
      if (Array.isArray(decl.dims) &&
          (at[0] < 0 || at[0] >= decl.dims[0] || at[1] < 0 || at[1] >= decl.dims[1])) {
        return `(${at[0]},${at[1]}) is outside grid "${decl.s}" of size ${decl.dims[0]}×${decl.dims[1]}`;
      }
      break;
    case 'map':
      if (at.length === 0) return `map "${decl.s}" needs at least one key segment`;
      break;
    case 'nodes':
    case 'graph':
      if (at.length === 0) return `"${decl.s}" needs at least a node id`;
      if (typeof at[0] === 'number') return `"${decl.s}" is addressed by node id, got integer ${at[0]}`;
      break;
  }
  return '';
}
