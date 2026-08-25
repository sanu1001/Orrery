// @ts-check
/**
 * React glue for the mutable player store.
 *
 * useSyncExternalStore is the supported primitive for exactly this shape --
 * "subscribe to a mutable external source and read a snapshot value" -- and it
 * is what prevents tearing when a component reads the mutable state during
 * render. The snapshot is an INTEGER (the store's version), never the state
 * itself; copying the state per frame is the failure mode the mutable store
 * exists to avoid. ADR 0010.
 */

import { useSyncExternalStore } from 'react';

/**
 * Re-renders the caller whenever the store mutates.
 * @param {import('./store.js').PlayerStore|null} store
 * @returns {number} the version, so callers can use it as a memo key
 */
export function usePlayerVersion(store) {
  return useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getVersion : zero,
    store ? store.getVersion : zero,
  );
}

const noopSubscribe = () => () => {};
const zero = () => 0;
