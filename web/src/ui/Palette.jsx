// @ts-check
import { useEffect, useMemo, useRef, useState } from 'react';
import { rank } from '../lib/fuzzy.js';

/** More than fits on a screen already; the cap exists so a pathological
 *  catalogue cannot make one keystroke render four hundred rows. */
const MAX = 60;

/**
 * The command palette.
 *
 * `/` and ctrl+K. It knows nothing about what a command is: the parent hands it
 * a `build(query)` and it filters, renders and calls `run`. Everything that
 * could be tested without a DOM already is -- `lib/fuzzy.js` for the matching
 * and `lib/commands.js` for the list -- which leaves this file as the part that
 * genuinely needs a browser.
 *
 * Why it exists at all: the demo is stepping through an algorithm while
 * talking, and switching algorithms mid-sentence currently means finding a
 * select element with a mouse. Two keystrokes and three letters is the
 * difference between a demo that flows and one that pauses.
 */
export default function Palette({ build, onClose }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(/** @type {HTMLInputElement|null} */(null));
  const listRef = useRef(/** @type {HTMLDivElement|null} */(null));

  // Rebuilt per keystroke because some commands READ the query -- "142" is the
  // step command and exists only while that is what is typed.
  const hits = useMemo(() => rank(build(q), q, (c) => c.title).slice(0, MAX), [build, q]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="1"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, hits]);

  const run = (cmd) => {
    if (!cmd) return;
    // Close FIRST. A command that changes the algorithm unmounts the store this
    // palette was built from, and closing afterwards sets state on the way out
    // of a render that has already been replaced.
    onClose();
    cmd.run();
  };

  const onKey = (e) => {
    switch (e.key) {
      case 'ArrowDown': setActive((i) => Math.min(hits.length - 1, i + 1)); break;
      case 'ArrowUp': setActive((i) => Math.max(0, i - 1)); break;
      case 'Home': setActive(0); break;
      case 'End': setActive(hits.length - 1); break;
      case 'Enter': run(hits[active]); break;
      case 'Escape': onClose(); break;
      // Tab would leave the palette while it still covers the screen. There is
      // nowhere else to go from here, so it moves the selection instead.
      case 'Tab': setActive((i) => (i + (e.shiftKey ? -1 : 1) + hits.length) % Math.max(1, hits.length)); break;
      default: return;
    }
    e.preventDefault();
  };

  return (
    <div className="palette-wrap" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="command palette"
           onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="an algorithm, a step number, a setting…"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-autocomplete="list"
          aria-activedescendant={hits[active] ? `pal-${hits[active].id}` : undefined}
        />
        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}
             aria-label="commands">
          {hits.length === 0 && <div className="pane-note">nothing matches that</div>}
          {hits.map((c, i) => (
            <div key={c.id} id={`pal-${c.id}`} role="option"
                 aria-selected={i === active} data-active={i === active ? 1 : 0}
                 className="palette-row"
                 onMouseMove={() => setActive(i)}
                 onClick={() => run(c)}>
              {/* The group rides on the ROW rather than as a heading above a
                  block of rows. Ranking reorders across groups, so headings
                  would fragment into one-row sections the moment anything is
                  typed -- and a layout that reorganises itself per keystroke is
                  harder to read than a slightly repetitive one. */}
              <span className="palette-group">{c.group}</span>
              <span className="palette-title">{c.title}</span>
              {c.hint ? <span className="palette-hint">{c.hint}</span> : null}
            </div>
          ))}
        </div>
        <div className="palette-foot">
          <kbd>↑</kbd><kbd>↓</kbd> move <kbd>enter</kbd> run <kbd>esc</kbd> close
        </div>
      </div>
    </div>
  );
}
