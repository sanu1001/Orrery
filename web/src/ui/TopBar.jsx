// @ts-check
/**
 * The picker is generated entirely from the catalogue, which is generated
 * entirely from the Go registry. That is why adding a thirteenth algorithm
 * needs no frontend change at all.
 */
export default function TopBar({ catalog, algo, onPick, trace, theme, onTheme, onHelp }) {
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
      <button onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}
              title="toggle theme" aria-label="toggle theme">
        {theme === 'dark' ? '◑' : '◐'}
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
