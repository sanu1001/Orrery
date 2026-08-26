// @ts-check
import OpenTraceButton from './OpenTraceButton.jsx';

/**
 * The picker is generated entirely from the catalogue, which is generated
 * entirely from the Go registry. That is why adding a thirteenth algorithm
 * needs no frontend change at all.
 */
export default function TopBar({ catalog, algo, onPick, trace, theme, onTheme, onHelp,
                                 fileName, onOpen, onSave, hueless, onHueless }) {
  const grouped = groupByFamily(catalog);
  return (
    <header className="topbar">
      <div className="logo"><Glyph /> Orrery</div>

      <select value={algo ?? ''} onChange={(e) => onPick(e.target.value)}
              aria-label="algorithm">
        <option value="" disabled>choose an algorithm…</option>
        {Object.entries(grouped).map(([family, items]) => (
          <optgroup key={family} label={family}>
            {items.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </optgroup>
        ))}
      </select>

      {/* Which file is on screen, when it did not come from the catalogue. The
          picker above reads "choose an algorithm…" in that case, and without
          this the app looks like it has nothing loaded while plainly playing
          something. */}
      {fileName && <span className="filename" title={fileName}>{fileName}</span>}

      {trace && (
        <span className="counter" title="input">
          {summariseInput(trace)}
        </span>
      )}

      <div className="spacer" />

      {trace && (
        <span className="counter">
          {trace.meta.counts.events} events · {trace.meta.counts.steps} steps
        </span>
      )}
      {onSave && (
        <button onClick={onSave} title="download this trace as .orrery.json"
                aria-label="download this trace">⭳</button>
      )}
      {onOpen && <OpenTraceButton onOpen={onOpen} />}
      <button onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}
              title="toggle theme" aria-label="toggle theme">
        {theme === 'dark' ? '◑' : '◐'}
      </button>
      {/* aria-pressed, not a label that changes: a toggle whose NAME changes
          reads as a different control each time it is pressed. */}
      <button onClick={() => onHueless?.(!hueless)}
              aria-pressed={!!hueless}
              title={hueless ? 'restore the semantic colours' : 'read without colour'}
              aria-label="read without colour">
        {hueless ? '◇' : '◆'}
      </button>
      <button onClick={onHelp} title="keyboard shortcuts" aria-label="keyboard shortcuts">?</button>
    </header>
  );
}

function groupByFamily(catalog) {
  const out = {};
  for (const s of catalog ?? []) (out[s.family] ??= []).push(s);
  return out;
}

function summariseInput(trace) {
  const input = trace?.meta?.input;
  if (!input || typeof input !== 'object') return '';
  return Object.entries(input)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`)
    .join('  ');
}

/**
 * The entire brand system: one glyph, monochrome, inheriting currentColor.
 * A filled body with two tilted orbits -- an orrery. Anything more is time not
 * spent on the renderers. UI_DESIGN.md 11.
 */
function Glyph() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="3.5" fill="var(--write)" />
      <ellipse cx="16" cy="16" rx="13" ry="5.5" fill="none"
               stroke="currentColor" strokeWidth="1.4" opacity="0.75" />
      <ellipse cx="16" cy="16" rx="5.5" ry="13" fill="none"
               stroke="currentColor" strokeWidth="1.4" opacity="0.75"
               transform="rotate(28 16 16)" />
    </svg>
  );
}
