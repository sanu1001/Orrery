// @ts-check
import { useEffect, useState } from 'react';

/**
 * Window-level drag-and-drop for `.orrery.json`.
 *
 * The whole window is the target rather than a bordered rectangle somewhere on
 * the page: by the time you are holding a trace file you want to look at,
 * hunting for a 200px drop zone is pure friction. The overlay appears on the
 * first dragenter, which is what keeps it discoverable anyway.
 *
 * Dragging is MOUSE ONLY, so this is never the only way in — the open button in
 * the top bar and the one on the empty state reach the same loader. Day 31 made
 * the app fully keyboard-operable and a drop-only affordance would quietly undo
 * that for the one feature whose whole point is portability.
 *
 * @param {(file: File) => void} onFile
 * @returns {boolean} whether a file is currently being dragged over the window
 */
export function useTraceFile(onFile) {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    // A depth counter, not a boolean. dragenter/dragleave fire for every child
    // element the pointer crosses, so a boolean blinks the overlay out the
    // instant the pointer passes from one pane to the next.
    let depth = 0;

    /** @param {DragEvent} e */
    const hasFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

    /** @param {DragEvent} e */
    const onEnter = (e) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setDragging(true);
    };

    /** @param {DragEvent} e */
    const onLeave = (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };

    /** @param {DragEvent} e */
    const onOver = (e) => {
      if (!hasFiles(e)) return;
      // Without preventDefault the browser navigates away to the file itself,
      // which looks exactly like the app crashing.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };

    /** @param {DragEvent} e */
    const onDrop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      // Only the first file. Two traces at once has no meaning in a UI with one
      // player, and silently loading whichever the browser listed first is
      // worse than plainly loading the first.
      if (file) onFile(file);
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [onFile]);

  return dragging;
}

/**
 * Hand the current trace back as a file.
 *
 * `text` is the bytes the trace ARRIVED as, never a re-encoding of the parsed
 * object. Round-tripping through JSON.parse/stringify is not identity here:
 * a map structure keyed "0", "1", "2" comes back with those keys reordered by
 * JavaScript's integer-key rules, and number formatting is the exact place Go
 * and JS already disagree (CLAUDE.md trap 2). Keeping the original bytes makes
 * the downloaded file diff clean against the golden fixture, which is the whole
 * claim C6 is making.
 *
 * @param {string} text
 * @param {string} filename
 */
export function downloadTrace(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Revoking synchronously can beat the download in some browsers; a task tick
  // is enough and this object is a few hundred KB at most.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
