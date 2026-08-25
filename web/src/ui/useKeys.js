// @ts-check
import { useEffect } from 'react';

/**
 * Keyboard-first is not decoration. The demo is you stepping through an
 * algorithm while talking; reaching for a mouse between every step breaks the
 * rhythm of the explanation, and an interviewer notices smoothness even when
 * they do not name it.
 *
 * @param {import('../player/store.js').PlayerStore|null} store
 * @param {{onHelp?: () => void, onFit?: () => void, onWatch?: () => void,
 *          onBreak?: () => void, onContinue?: (dir: number) => void}} handlers
 */
export function useKeys(store, handlers = {}) {
  useEffect(() => {
    const onKey = (e) => {
      const el = /** @type {HTMLElement} */ (e.target);
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '?') { handlers.onHelp?.(); e.preventDefault(); return; }
      if (e.key === 'Escape') { handlers.onFit?.(); return; }
      if (!store) return;

      // The debugger keys act on the address under the cursor or pinned, which
      // is what makes watches and breakpoints reachable without a mouse -- the
      // panes already publish that address through the focus protocol.
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === 'w') { handlers.onWatch?.(); e.preventDefault(); return; }
      if (k === 'b') { handlers.onBreak?.(); e.preventDefault(); return; }
      if (k === 'c') {
        handlers.onContinue?.(e.shiftKey ? -1 : 1);
        e.preventDefault();
        return;
      }

      switch (e.key) {
        case ' ':          store.toggle(); break;
        case 'ArrowRight':
        case 'j':          e.shiftKey ? store.seek(store.step + 10) : store.next(); break;
        case 'ArrowLeft':
        case 'k':          e.shiftKey ? store.seek(store.step - 10) : store.prev(); break;
        case 'Home':       store.seek(0); break;
        case 'End':        store.seek(store.stepCount); break;
        case '[':          store.setSpeed(Math.max(1, store.speed / 2)); break;
        case ']':          store.setSpeed(Math.min(16, store.speed * 2)); break;
        case 'd':          store.setLevel(store.level === 0 ? 1 : 0); break;
        default:
          if (/^[0-9]$/.test(e.key)) {
            store.seek(Math.round((Number(e.key) / 10) * store.stepCount));
            break;
          }
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, handlers]);
}
