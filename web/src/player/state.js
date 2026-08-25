// @ts-check
/**
 * The state model, and the semantics of applying an event.
 *
 * This is a deliberate mirror of internal/trace/state.go. The two are written
 * twice ON PURPOSE: two independent implementations that must agree at every
 * step is the mechanism by which the format gets tested, not an accident of
 * having two languages. scripts/conformance.sh diffs their hashes.
 *
 * STORAGE MODEL -- must match the Go twin exactly:
 *
 *   scalar / array / grid / map : one flat Map keyed by at.join('/').
 *                                 A missing key reads as `fill`.
 *   nodes / graph               : at[0] selects a top-level slot (a node id,
 *                                 '$refs' or '$edges'); further segments
 *                                 descend into plain objects.
 *
 * Grid and array are stored SPARSELY and read through to `fill`. That is what
 * makes forward-then-backward land on a byte-identical state with no special
 * casing, because the hash skips any value equal to `fill`: present-with-fill
 * and absent hash the same.
 */

import { addrKey, canon, clone, deepEqual } from '../lib/value.js';

const NS_REFS = '$refs';
const NS_EDGES = '$edges';

const NODE_KINDS = new Set(['nodes', 'graph']);

export class Struct {
  /** @param {object} init the init event */
  constructor(init) {
    this.name = init.s;
    this.kind = init.kind;
    this.dims = init.dims ?? null;
    this.fill = init.fill ?? null;
    this.aux = !!init.aux;
    this.labels = init.labels ?? null;
    this.schema = init.schema ?? null;
    this.isNodeKind = NODE_KINDS.has(this.kind);

    /** @type {Map<string,*>} flat cells, for scalar/array/grid/map */
    this.flat = this.isNodeKind ? null : new Map();
    /** @type {Object<string,*>|null} top-level slots, for nodes/graph */
    this.root = this.isNodeKind ? Object.create(null) : null;
    /** @type {string[]} node creation order */
    this.order = [];
  }

  /** @param {Array<number|string>} at */
  get(at) {
    if (!this.isNodeKind) {
      const k = at.join('/');
      return this.flat.has(k) ? this.flat.get(k) : this.fill;
    }
    if (at.length === 0) return this.fill;
    let cur = this.root[String(at[0])];
    if (cur === undefined) return this.fill;
    for (let i = 1; i < at.length; i++) {
      if (cur === null || typeof cur !== 'object') return this.fill;
      const seg = at[i];
      const next = Array.isArray(cur) ? cur[Number(seg)] : cur[String(seg)];
      if (next === undefined) return this.fill;
      cur = next;
    }
    return cur;
  }

  /**
   * Writes v at at. The value is CLONED: without that, unapplying a node
   * creation would mutate the very event that created it, and the second
   * rewind through it would be wrong.
   * @param {Array<number|string>} at
   */
  set(at, v) {
    const val = clone(v);
    if (!this.isNodeKind) {
      this.flat.set(at.join('/'), val);
      return;
    }
    if (at.length === 0) return;
    const head = String(at[0]);
    if (!(head in this.root)) this.order.push(head);
    if (at.length === 1) {
      this.root[head] = val;
      return;
    }
    let container = this.root[head];
    if (container === undefined || container === null || typeof container !== 'object') {
      container = {};
      this.root[head] = container;
    }
    for (let i = 1; i < at.length - 1; i++) {
      const seg = String(at[i]);
      let next = container[seg];
      if (next === undefined || next === null || typeof next !== 'object') {
        next = {};
        container[seg] = next;
      }
      container = next;
    }
    container[String(at[at.length - 1])] = val;
  }

  /** @param {string} id */
  exists(id) {
    return this.isNodeKind && this.root[id] !== undefined && this.root[id] !== null;
  }

  /** Node slots in creation order, excluding the reserved namespaces. */
  nodeIDs() {
    return this.order.filter((id) => id !== NS_REFS && id !== NS_EDGES);
  }

  /** Named pointers as {name: nodeId}. */
  refs() {
    const out = {};
    const r = this.isNodeKind ? this.root[NS_REFS] : null;
    if (r && typeof r === 'object') {
      for (const k of Object.keys(r)) {
        const v = r[k];
        out[k] = v && typeof v === 'object' && typeof v.$ === 'string' ? v.$ : null;
      }
    }
    return out;
  }

  /** Edge attribute records as {"u|v": {w: ...}}. */
  edges() {
    const e = this.isNodeKind ? this.root[NS_EDGES] : null;
    return e && typeof e === 'object' ? e : {};
  }

  /** @param {Array<number|string>} at */
  key(at) {
    return addrKey(this.name, at);
  }
}

export class State {
  /** @param {object} trace a validated trace */
  constructor(trace) {
    /** @type {Map<string, Struct>} */
    this.structs = new Map();
    /** @type {string[]} creation order */
    this.order = [];
    /** @type {number[]} event indices of open calls, oldest first */
    this.stack = [];

    // Pair every ret with its call, once. Backward stepping through a ret needs
    // to know which frame to restore, and scanning for it would make prev()
    // O(n) instead of O(1).
    /** @type {Map<number, number>} */
    this.retToCall = new Map();
    const st = [];
    const evs = trace.events;
    for (let i = 0; i < evs.length; i++) {
      if (evs[i].t === 'call') st.push(i);
      else if (evs[i].t === 'ret') this.retToCall.set(i, st.length ? st.pop() : -1);
    }
  }

  /** @param {string} name @param {Array<number|string>} at */
  get(name, at) {
    const s = this.structs.get(name);
    return s ? s.get(at) : null;
  }

  /**
   * Apply one event forward.
   *
   * MUST NOT ALLOCATE on the `set` path. Everything about the perceived speed
   * of this app is downstream of that: seeking is O(distance), so one scrubber
   * drag applies thousands of events, and an allocation per apply turns that
   * into GC pressure and a stuttering scrubber. `changed` is mutated in place
   * for the same reason.
   *
   * @param {number} idx event index
   * @param {object} e
   * @param {Set<string>|null} changed mutated in place
   */
  forward(idx, e, changed) {
    switch (e.t) {
      case 'init': {
        const s = new Struct(e);
        this.structs.set(e.s, s);
        this.order.push(e.s);
        if (changed) changed.add(e.s + ' ');
        break;
      }
      case 'set': {
        const s = this.structs.get(e.s);
        if (!s) return;
        s.set(e.at ?? [], e.to);
        if (changed) changed.add(addrKey(e.s, e.at ?? []));
        break;
      }
      case 'call':
        this.stack.push(idx);
        break;
      case 'ret':
        this.stack.pop();
        break;
    }
  }

  /** Undo one event using only that event (invariant I1). */
  backward(idx, e, changed) {
    switch (e.t) {
      case 'init': {
        this.structs.delete(e.s);
        const i = this.order.lastIndexOf(e.s);
        if (i >= 0) this.order.splice(i, 1);
        if (changed) changed.add(e.s + ' ');
        break;
      }
      case 'set': {
        const s = this.structs.get(e.s);
        if (!s) return;
        s.set(e.at ?? [], e.from);
        if (changed) changed.add(addrKey(e.s, e.at ?? []));
        break;
      }
      case 'call':
        this.stack.pop();
        break;
      case 'ret': {
        const c = this.retToCall.get(idx);
        if (c !== undefined && c >= 0) this.stack.push(c);
        break;
      }
    }
  }

  /**
   * Every live address with its canonical value, sorted.
   *
   * Values equal to the structure's `fill` are SKIPPED. That is what makes
   * sparse and dense storage hash identically, and what makes a rewind land
   * back on the initial hash with no special casing.
   * @returns {string[]}
   */
  addresses() {
    const names = [...this.structs.keys()].sort();
    const out = [];
    for (const n of names) {
      const s = this.structs.get(n);
      if (s.isNodeKind) {
        for (const k of Object.keys(s.root).sort()) {
          appendLeaves(out, s, n + ' ' + k, s.root[k]);
        }
      } else {
        for (const k of [...s.flat.keys()].sort()) {
          const v = s.flat.get(k);
          if (deepEqual(v, s.fill)) continue;
          out.push(n + ' ' + k + '=' + canon(v));
        }
      }
    }
    return out;
  }

  /**
   * FNV-1a over the sorted address list plus the call stack.
   * Must produce the same 64-bit value as trace.State.Hash in Go.
   * @returns {bigint}
   */
  hash() {
    const MASK = (1n << 64n) - 1n;
    const PRIME = 1099511628211n;
    let h = 14695981039346656037n;
    const write = (str) => {
      for (let i = 0; i < str.length; i++) {
        h = (h ^ BigInt(str.charCodeAt(i) & 0xff)) & MASK;
        h = (h * PRIME) & MASK;
      }
      h = (h * PRIME) & MASK; // the trailing 0x00 separator
    };
    for (const a of this.addresses()) write(a);
    write('#stack');
    for (const f of this.stack) write(String(f));
    return h;
  }
}

function appendLeaves(out, s, prefix, v) {
  if (deepEqual(v, s.fill)) return;
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && typeof v.$ !== 'string') {
    for (const k of Object.keys(v).sort()) appendLeaves(out, s, prefix + '/' + k, v[k]);
    return;
  }
  out.push(prefix + '=' + canon(v));
}
