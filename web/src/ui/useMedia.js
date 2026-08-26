// @ts-check
import { useSyncExternalStore } from 'react';

/**
 * One MediaQueryList per query, kept because getSnapshot runs on every render
 * and on every resize event. Building a fresh one each time would allocate
 * during a drag, and React compares snapshots by identity -- a boolean, so it
 * is safe, but the allocation is not free.
 * @type {Map<string, MediaQueryList>}
 */
const LISTS = new Map();

function mql(query) {
  let m = LISTS.get(query);
  if (!m) { m = window.matchMedia(query); LISTS.set(query, m); }
  return m;
}

/**
 * Subscribe to a media query.
 *
 * This exists because Split Studio's code rail cannot be a pure CSS decision. A
 * media query can hide the rail, but hiding the code pane is the wrong answer
 * at 1280px -- "the code, the data and the reason, shown together" is the whole
 * claim, and dropping the code to save a column quietly retracts it. What has
 * to happen instead is that the pane MOVES back into the inspector, and CSS
 * cannot move a node between parents.
 *
 * useSyncExternalStore rather than a resize listener with useState, for the
 * same reason the player store uses it: it is the only subscription primitive
 * that cannot tear, and a mid-render width change would otherwise render half
 * the tree against one layout and half against the other.
 *
 * @param {string} query
 * @returns {boolean}
 */
export function useMedia(query) {
  return useSyncExternalStore(
    (onChange) => {
      const m = mql(query);
      m.addEventListener('change', onChange);
      // `resize` as well as `change`, because `change` is not dependable. A
      // viewport driven by devtools emulation updates `matches` correctly and
      // never fires the event, so the layout stayed on the wide grid at 1280px
      // while matchMedia already disagreed with it. Re-reading on resize costs
      // a boolean compare -- useSyncExternalStore bails out when the snapshot
      // is unchanged, so the common case is not a re-render.
      window.addEventListener('resize', onChange);
      return () => {
        m.removeEventListener('change', onChange);
        window.removeEventListener('resize', onChange);
      };
    },
    () => mql(query).matches,
    // Server snapshot: the narrow layout. Guessing wide would render a rail
    // that then vanishes on hydration, which is a worse first frame than a
    // rail that appears.
    () => false,
  );
}
