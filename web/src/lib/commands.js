// @ts-check
import { addrLabel } from './value.js';

/**
 * Everything the command palette can do, as data.
 *
 * A pure function of the current session, so it is testable without React and
 * without a DOM: hand it a catalogue and a store and assert what comes back.
 * The palette itself then has no knowledge of what a command IS -- it filters,
 * it renders, it calls `run`.
 *
 * @typedef {object} Command
 * @property {string} id      stable, and the fallback sort key
 * @property {string} group   the heading it appears under
 * @property {string} title   what is matched against and shown
 * @property {string} [hint]  right-aligned, never matched against
 * @property {() => void} run
 */

/**
 * @param {object} ctx
 * @param {any[]} ctx.catalog
 * @param {string|null} ctx.algo
 * @param {import('../player/store.js').PlayerStore|null} ctx.store
 * @param {any} ctx.trace
 * @param {string} ctx.theme
 * @param {boolean} ctx.hueless
 * @param {any} ctx.focus
 * @param {any[]} [ctx.breakpoints]
 * @param {string} ctx.query          the raw text, for the commands that read it
 * @param {object} ctx.actions
 * @returns {Command[]}
 */
export function buildCommands(ctx) {
  const { catalog = [], store, actions = {} } = ctx;
  /** @type {Command[]} */
  const out = [];

  // A BARE NUMBER IS A STEP, and it goes first because someone who typed "142"
  // wants step 142 and nothing else. Offering it alongside every algorithm
  // whose name contains a 1 would be technically complete and useless.
  const n = Number(ctx.query);
  if (store && ctx.query.trim() !== '' && Number.isInteger(n) && n >= 0) {
    const target = Math.min(n, store.stepCount);
    out.push({
      id: 'step',
      group: 'Go to',
      title: `Step ${target}`,
      hint: target === n ? `of ${store.stepCount}` : `clamped from ${n}`,
      run: () => store.seek(target),
    });
  }

  for (const spec of catalog) {
    out.push({
      id: `algo:${spec.id}`,
      group: 'Algorithm',
      // The family is part of what is MATCHED, not only shown: "graph dij" and
      // "sorting heap" are both things people type, and neither works if the
      // family lives in the hint.
      title: `${spec.title} · ${spec.family}`,
      hint: spec.id === ctx.algo ? 'showing' : '',
      run: () => actions.pick?.(spec.id),
    });
  }

  if (store) {
    const at = store.step;
    out.push(
      { id: 'play', group: 'Go to', title: store.isPlaying() ? 'Pause' : 'Play', hint: 'Space', run: () => store.toggle() },
      { id: 'first', group: 'Go to', title: 'First step', hint: 'Home', run: () => store.seek(0) },
      { id: 'last', group: 'Go to', title: 'Last step', hint: 'End', run: () => store.seek(store.stepCount) },
    );
    // Only when there IS a prologue. A command that does nothing is
    // indistinguishable from a broken one.
    if (store.startStep > 0 && at !== store.startStep) {
      out.push({
        id: 'start',
        group: 'Go to',
        title: 'Skip the construction prologue',
        hint: `step ${store.startStep}`,
        run: () => store.seek(store.startStep),
      });
    }
    out.push({
      id: 'detail',
      group: 'View',
      title: store.level === 0 ? 'Detail: show every comparison' : 'Detail: show writes only',
      hint: 'd',
      run: () => store.setLevel(store.level === 0 ? 1 : 0),
    });
  }

  out.push(
    {
      id: 'theme',
      group: 'View',
      title: ctx.theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme',
      run: () => actions.setTheme?.(ctx.theme === 'dark' ? 'light' : 'dark'),
    },
    {
      id: 'hueless',
      group: 'View',
      title: ctx.hueless ? 'Bring the colour back' : 'Read the whole app in grey',
      hint: 'hueless',
      run: () => actions.setHueless?.(!ctx.hueless),
    },
    { id: 'keys', group: 'View', title: 'Keyboard shortcuts', hint: '?', run: () => actions.help?.() },
  );

  // The debugger commands are about the address under the cursor, so they only
  // exist when there is one. Listing "Watch" with nothing to watch would be a
  // command that silently fails.
  if (ctx.focus && ctx.focus.kind === 'cell') {
    const label = addrLabel(ctx.focus.s, ctx.focus.at ?? []);
    out.push(
      { id: 'watch', group: 'Debugger', title: `Watch ${label}`, hint: 'w', run: () => actions.watch?.() },
      { id: 'break', group: 'Debugger', title: `Break when ${label} is written`, hint: 'b', run: () => actions.breakpoint?.() },
    );
  }
  if (store && (ctx.breakpoints ?? []).length > 0) {
    out.push(
      { id: 'cont', group: 'Debugger', title: 'Run to the next breakpoint', hint: 'c', run: () => store.continueTo(1) },
      { id: 'contback', group: 'Debugger', title: 'Run back to the previous breakpoint', hint: 'shift + c', run: () => store.continueTo(-1) },
    );
  }

  if (ctx.trace && actions.save) {
    out.push({ id: 'save', group: 'Trace', title: 'Download this trace as a file', run: () => actions.save?.() });
  }

  return out;
}
