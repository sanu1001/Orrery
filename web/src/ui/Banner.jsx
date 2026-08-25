// @ts-check
/**
 * Inline and specific. Never a modal, never a toast that disappears before it
 * is read, and every message says what still works.
 */
export default function Banner({ kind = 'info', title, children }) {
  return (
    <div className={`banner${kind === 'err' ? ' err' : ''}`} role="status">
      <span className="mark" aria-hidden="true">{kind === 'err' ? '!' : '◆'}</span>
      <div>
        {title && <b>{title}. </b>}
        {children}
      </div>
    </div>
  );
}
