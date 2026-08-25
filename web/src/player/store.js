// @ts-check
/**
 * The player: mutable algorithm state plus forward / backward / seek / play.
 *
 * THE INVARIANT, and it is the sharpest edge in this codebase:
 *
 *   ALL MUTATIONS HAPPEN OUTSIDE RENDER, SYNCHRONOUSLY, FOLLOWED BY A VERSION
 *   BUMP. React observes this store through useSyncExternalStore, which
 *   prevents tearing ONLY under that condition. Violating it produces subtle
 *   visual glitches, not loud errors.
 *
 * Why mutable at all: seeking is O(distance), so dragging a scrubber across a
 * 9,000-step trace applies ~9,000 events inside one gesture. With immutable
 * updates that is ~900,000 cell copies and 9,000 short-lived objects per drag;
 * the scrubber stutters, and the usual fix (throttling the scrubber) makes
 * seeking feel laggy -- the exact property the architecture promised would be
 * instant. Mutable makes an apply one Map.set. ADR 0010.
 */

import { State } from './state.js';
import { buildSteps, stepIndexOf } from './steps.js';
import { buildIndex } from './prepass.js';

export class PlayerStore {
  /**
   * @param {object} trace a VALIDATED trace
   * @param {import('./prepass.js').Index} index from buildIndex()
   * @param {number} [level]
   */
  constructor(trace, index, level = 0) {
    this.trace = trace;
    this.index = index;
    this.level = level;
    this.steps = index.steps;
    this.state = new State(trace);

    this._version = 0;
    this._step = 0;
    this._changed = new Set();
    this._listeners = new Set();
    this._timer = null;
    this._flashTimer = null;
    this._sps = 2; // steps per second
    this._animate = true;
  }

  // --- reads: safe during render -------------------------------------------

  get version() { return this._version; }
  get step() { return this._step; }
  get stepCount() { return this.steps.length; }

  /**
   * Where the trace stops being setup and starts being the algorithm: the step
   * containing the first event after any declared construction prologue, or 0.
   *
   * Derived here rather than declared, because a producer cannot know step
   * numbers -- steps are grouping plus the viewer's detail level, and the same
   * trace has different ones at level 0 and level 1. So the view declares an
   * EVENT and this maps it, which it can always do. It is recomputed by
   * setLevel for exactly that reason.
   *
   * The prologue steps are ordinary steps, never hidden: the point is to open
   * past them, not to make them unreachable.
   */
  get startStep() {
    const ev = Math.max(0, ...(this.trace?.meta?.views ?? []).map((v) => v.startEvent ?? 0));
    if (ev <= 0) return 0;
    const i = stepIndexOf(this.steps, ev);
    return i < 0 ? 0 : i;
  }

  get eventIndex() {
    return this._step >= this.steps.length ? this.trace.events.length : this.steps[this._step].e0;
  }

  /** @param {string} name */
  struct(name) { return this.state.structs.get(name); }

  /** Address keys touched by the last transition. Drives CSS flashing. */
  changed() { return this._changed; }

  /** Events of the step just applied -- the explain pane's input. */
  currentEvents() {
    if (this._step === 0) return [];
    const s = this.steps[this._step - 1];
    return this.trace.events.slice(s.e0, s.e1);
  }

  /** Current source line, or 0. */
  currentLine() {
    const evs = this.currentEvents();
    for (let i = evs.length - 1; i >= 0; i--) if (evs[i].ln) return evs[i].ln;
    return 0;
  }

  /** Open call frames, oldest first. */
  callStack() {
    return this.state.stack.map((i) => ({ eventIdx: i, ...this.trace.events[i] }));
  }

  /** The most recent return, for one step, so a pop is not invisible. */
  lastReturn() {
    const evs = this.currentEvents();
    for (let i = evs.length - 1; i >= 0; i--) {
      if (evs[i].t === 'ret') return evs[i];
    }
    return null;
  }

  isPlaying() { return this._timer !== null; }

  /** True while a multi-step jump is in progress; renderers skip animation. */
  get animating() { return this._animate; }

  // --- writes: NEVER during render -----------------------------------------

  next() {
    if (this._step >= this.steps.length) { this.pause(); return false; }
    this._changed = new Set();
    const s = this.steps[this._step];
    for (let i = s.e0; i < s.e1; i++) {
      this.state.forward(i, this.trace.events[i], this._changed);
    }
    this._step++;
    this._animate = true;
    this._emit();
    return true;
  }

  prev() {
    if (this._step === 0) return false;
    this._changed = new Set();
    const s = this.steps[this._step - 1];
    // REVERSE ORDER within the step. Without it a grouped swap rewinds into a
    // duplicated value: restoring a[i] after a[j] has already been restored
    // from it. This is the one place ordering matters. ADR 0020.
    for (let i = s.e1 - 1; i >= s.e0; i--) {
      this.state.backward(i, this.trace.events[i], this._changed);
    }
    this._step--;
    this._animate = true;
    this._emit();
    return true;
  }

  /**
   * Moves INCREMENTALLY from the current position -- never by replaying from 0.
   * That is the whole point of a reversible log, and it keeps prev() on the hot
   * path, which is the direction that actually breaks.
   *
   * Seeking sets animate=false: a scrub must snap, then flash everything that
   * changed, rather than animating through hundreds of intermediate states.
   * FRONTEND.md 7.
   * @param {number} step
   */
  seek(step) {
    step = Math.max(0, Math.min(step, this.steps.length));
    if (step === this._step) return;
    const acc = new Set();
    const collect = () => { for (const k of this._changed) acc.add(k); };
    while (this._step < step) { this.next(); collect(); }
    while (this._step > step) { this.prev(); collect(); }
    this._changed = acc;
    this._animate = false;
    this._emit();
  }

  /** @param {number} [stepsPerSecond] */
  play(stepsPerSecond) {
    if (stepsPerSecond) this._sps = stepsPerSecond;
    if (this._timer !== null) return;
    if (this._step >= this.steps.length) this.seek(0);
    const tick = () => {
      if (!this.next()) return;
      this._timer = setTimeout(tick, 1000 / this._sps);
    };
    this._timer = setTimeout(tick, 0);
    this._emit();
  }

  pause() {
    if (this._timer !== null) { clearTimeout(this._timer); this._timer = null; this._emit(); }
  }

  toggle() { this.isPlaying() ? this.pause() : this.play(); }

  get speed() { return this._sps; }
  setSpeed(sps) { this._sps = sps; if (this.isPlaying()) { this.pause(); this.play(); } else this._emit(); }

  /**
   * Rebuild the step index over events with lvl <= n, then land on the nearest
   * surviving step.
   *
   * Sound only because lvl > 0 is restricted to aux structures. The sharp
   * version of the argument: every `set` carries its full `to` value, never a
   * delta, so dropping an event cannot change what any other event writes. The
   * only casualty is the filtered structure going stale -- which is harmless
   * precisely because `aux` is what makes it hidden. ADR 0016.
   * @param {number} n
   */
  setLevel(n) {
    if (n === this.level) return;
    const evAt = this.eventIndex;
    this.level = n;
    this.steps = buildSteps(this.trace.events, n);
    this.index = buildIndex(this.trace, n);
    this.state = new State(this.trace);
    this._step = 0;
    this._changed = new Set();
    let target = this.steps.length;
    for (let k = 0; k < this.steps.length; k++) {
      if (this.steps[k].e0 >= evAt) { target = k; break; }
    }
    this.seek(target);
  }

  // --- react glue -----------------------------------------------------------

  subscribe = (fn) => {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  };

  getVersion = () => this._version;

  /**
   * A flash is TEMPORAL: highlight what changed, then stop.
   *
   * Without this, `changed` persists and a deep link to step 60 arrives with
   * every cell touched along the way lit up at once -- which reads as "the
   * whole board is important" rather than "this cell just changed". Seeking
   * accumulates the union of everything that moved and flashes it ONCE; the
   * timer is what makes "once" true. FRONTEND.md 7.
   */
  _scheduleFlashClear() {
    if (this._flashTimer !== null) clearTimeout(this._flashTimer);
    if (this._changed.size === 0) return;
    const ms = this.isPlaying() ? Math.min(600, 900 / this._sps) : 700;
    this._flashTimer = setTimeout(() => {
      this._flashTimer = null;
      this._changed = new Set();
      this._version++;
      for (const fn of this._listeners) fn();
    }, ms);
  }

  _emit() {
    this._scheduleFlashClear();
    this._version++;
    for (const fn of this._listeners) fn();
  }

  /** Stop timers when the store is discarded, so a swapped algorithm does not
   *  leave a play loop running against a dead store. */
  dispose() {
    this.pause();
    if (this._flashTimer !== null) clearTimeout(this._flashTimer);
  }
}
