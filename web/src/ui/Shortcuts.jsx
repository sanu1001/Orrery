// @ts-check
const KEYS = [
  ['Space', 'play / pause'],
  ['→  or  j', 'next step'],
  ['←  or  k', 'previous step'],
  ['Shift + → / ←', 'jump ten steps'],
  ['Home / End', 'first / last step'],
  ['[  /  ]', 'slower / faster'],
  ['0 – 9', 'jump to n/10 through the trace'],
  ['d', 'toggle detail level'],
  ['w', 'watch the address under the cursor'],
  ['b', 'breakpoint on it'],
  ['c  /  Shift + c', 'run to next / previous breakpoint'],
  ['/  or  ctrl + K', 'command palette'],
  ['Esc', 'clear the pinned highlight'],
  ['?', 'this list'],
];

export default function Shortcuts({ onClose }) {
  return (
    <div className="shortcuts" onClick={onClose} role="dialog" aria-label="keyboard shortcuts">
      <div className="box" onClick={(e) => e.stopPropagation()}>
        <div className="section-head" style={{ border: 0, padding: 0, marginBottom: 12 }}>
          Keyboard
        </div>
        <table>
          <tbody>
            {KEYS.map(([k, what]) => (
              <tr key={k}><td><kbd>{k}</kbd></td><td>{what}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="pane-note" style={{ marginTop: 16, marginBottom: 0 }}>
          Keyboard-first is not decoration: stepping through an algorithm while
          talking is the whole demo, and reaching for a mouse between steps
          breaks the rhythm.
        </p>
      </div>
    </div>
  );
}
