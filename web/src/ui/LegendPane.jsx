// @ts-check

/**
 * What the five colours mean.
 *
 * The explanations name these colours in words -- "the amber write", "the cyan
 * addresses it read" -- so the mapping has to be stated somewhere on screen or
 * those sentences refer to something the reader was expected to already know.
 *
 * It is also the one panel that is most useful BEFORE a run and least useful
 * during it, which is why it sits at the bottom of the rail rather than the top.
 *
 * Each row carries its glyph and its border style as well as its hue, so the
 * legend is legible under the hueless toggle -- a colour key that goes blank
 * when colour is removed would be a poor advertisement for the claim that
 * nothing here depends on colour alone.
 */
const ROWS = [
  { k: 'write', glyph: 'w', name: 'amber', meaning: 'written this step' },
  { k: 'read', glyph: 'r', name: 'cyan', meaning: 'read to produce it' },
  { k: 'cursor', glyph: '→', name: 'violet', meaning: 'a pointer' },
  { k: 'settled', glyph: '✓', name: 'green', meaning: 'settled' },
  { k: 'pruned', glyph: '✗', name: 'rose', meaning: 'failed / backtracked' },
];

export default function LegendPane() {
  return (
    <>
      <div className="section-head">What the five colours mean</div>
      <ul className="legend">
        {ROWS.map((r) => (
          <li key={r.k} className="legend-row" data-k={r.k}>
            <span className="legend-chip" aria-hidden="true">{r.glyph}</span>
            <span className="legend-name">{r.name}</span>
            <span className="legend-meaning">{r.meaning}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
