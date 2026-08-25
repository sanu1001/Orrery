// @ts-check
import { useRef } from 'react';

/**
 * The keyboard-reachable half of C6.
 *
 * A file input styled to look like a button, rather than a button that fakes
 * one: the native control is what gives us focus, Enter/Space and the platform
 * file dialog for free, and every attempt to reimplement that ends up worse for
 * the people who need it most.
 *
 * Lives in its own file because both the top bar and the empty state offer it,
 * and having two of them drift apart is how one of them stops working.
 *
 * @param {{onOpen: (file: File) => void, className?: string, children?: any}} props
 */
export default function OpenTraceButton({ onOpen, className = '', children }) {
  const input = useRef(/** @type {HTMLInputElement|null} */(null));
  return (
    <>
      {/* Labelled explicitly because the default child is a bare glyph, and a
          screen reader announcing "⭱" is the same as announcing nothing. */}
      <button className={className} onClick={() => input.current?.click()}
              title="open a .orrery.json file" aria-label="open a trace file">
        {children ?? '⭱'}
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onOpen(file);
          // Cleared so that picking the SAME file twice fires change again --
          // which is exactly what you do after regenerating a trace on disk.
          e.target.value = '';
        }}
      />
    </>
  );
}
