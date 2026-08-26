// @ts-check
/**
 * A Go tokenizer for the code pane.
 *
 * Whole-file, not line-by-line, because Go has two constructs a per-line
 * tokenizer gets wrong and gets wrong SILENTLY: block comments, and raw string
 * literals in backticks. Both can span lines, and a stateless tokenizer
 * restarts inside one and begins highlighting its contents as code -- so a
 * commented-out block lights up as if it were live, which is worse than no
 * highlighting at all.
 *
 * It is a lexer, not a parser. It never needs to know what a name MEANS, only
 * what shape it has, so there is no symbol table and no scope tracking; `fn` is
 * "an identifier immediately followed by (" and nothing more. That is enough
 * for reading and it cannot go stale against the compiler.
 *
 * Deliberately not a dependency. Highlighting one language for a read-only pane
 * is about 90 lines; the smallest general highlighter is several hundred
 * kilobytes, and CLAUDE.md caps this project at four npm packages.
 */

/**
 * @typedef {'kw'|'str'|'com'|'num'|'fn'|'pun'|'id'|'ws'} Kind
 * @typedef {{t: string, k: Kind}} Token
 */

// The full Go keyword set, plus the predeclared names that read as keywords to
// someone scanning the file. Predeclared identifiers are not reserved in Go --
// you may shadow `len` -- but colouring them as ordinary names would be more
// surprising than the technical inaccuracy.
const KEYWORDS = new Set([
  'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else',
  'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface',
  'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type', 'var',
  'bool', 'byte', 'complex64', 'complex128', 'error', 'float32', 'float64',
  'int', 'int8', 'int16', 'int32', 'int64', 'rune', 'string',
  'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr',
  'true', 'false', 'iota', 'nil',
  'append', 'cap', 'clear', 'close', 'complex', 'copy', 'delete', 'imag', 'len',
  'make', 'max', 'min', 'new', 'panic', 'print', 'println', 'real', 'recover',
]);

const IDENT_START = /[A-Za-z_À-￿]/;
const IDENT_PART = /[A-Za-z0-9_À-￿]/;

/**
 * Tokenize a whole Go file into one token array per line.
 *
 * Newlines never appear inside a token: a block comment or raw string that
 * spans lines is emitted as one token PER LINE, each carrying the same kind.
 * The pane renders line by line, so a token that straddled a line break could
 * not be drawn at all.
 *
 * @param {string} text
 * @returns {Token[][]} one entry per line, in order
 */
export function tokenizeGo(text) {
  const lines = String(text ?? '').split('\n');
  /** @type {Token[][]} */
  const out = [];

  // The only state that crosses a line boundary. Everything else is local.
  let inBlockComment = false;
  let inRawString = false;

  for (const line of lines) {
    /** @type {Token[]} */
    const toks = [];
    let i = 0;
    const push = (t, k) => { if (t) toks.push({ t, k }); };

    while (i < line.length) {
      if (inBlockComment) {
        const end = line.indexOf('*/', i);
        if (end < 0) { push(line.slice(i), 'com'); i = line.length; break; }
        push(line.slice(i, end + 2), 'com');
        i = end + 2;
        inBlockComment = false;
        continue;
      }
      if (inRawString) {
        const end = line.indexOf('`', i);
        if (end < 0) { push(line.slice(i), 'str'); i = line.length; break; }
        push(line.slice(i, end + 1), 'str');
        i = end + 1;
        inRawString = false;
        continue;
      }

      const c = line[i];

      if (c === '/' && line[i + 1] === '/') { push(line.slice(i), 'com'); break; }
      if (c === '/' && line[i + 1] === '*') {
        inBlockComment = true;
        push(line.slice(i, i + 2), 'com');
        i += 2;
        continue;
      }
      if (c === '`') { inRawString = true; push(c, 'str'); i++; continue; }

      if (c === '"' || c === "'") {
        // An escaped quote does not close the literal, and a backslash before
        // it may itself be escaped -- "a\\" is a complete string.
        let j = i + 1;
        while (j < line.length) {
          if (line[j] === '\\') { j += 2; continue; }
          if (line[j] === c) { j++; break; }
          j++;
        }
        push(line.slice(i, Math.min(j, line.length)), 'str');
        i = j;
        continue;
      }

      if (/\s/.test(c)) {
        let j = i; while (j < line.length && /\s/.test(line[j])) j++;
        push(line.slice(i, j), 'ws');
        i = j;
        continue;
      }

      if (/[0-9]/.test(c)) {
        let j = i;
        while (j < line.length && /[0-9a-fA-FxXoObB._]/.test(line[j])) j++;
        push(line.slice(i, j), 'num');
        i = j;
        continue;
      }

      if (IDENT_START.test(c)) {
        let j = i; while (j < line.length && IDENT_PART.test(line[j])) j++;
        const word = line.slice(i, j);
        // A call is an identifier immediately followed by "(" -- no lookahead
        // past whitespace, because `if (x)` would otherwise make `if` a call.
        const k = KEYWORDS.has(word) ? 'kw' : (line[j] === '(' ? 'fn' : 'id');
        push(word, k);
        i = j;
        continue;
      }

      let j = i;
      while (j < line.length && !IDENT_START.test(line[j]) && !/[\s0-9"'`]/.test(line[j])
             && !(line[j] === '/' && (line[j + 1] === '/' || line[j + 1] === '*'))) j++;
      push(line.slice(i, Math.max(j, i + 1)), 'pun');
      i = Math.max(j, i + 1);
    }

    out.push(toks);
  }
  return out;
}

/**
 * Tokenize by language, falling back to one plain token per line.
 *
 * `lang` comes from the trace, so this stays data-driven: C++ arrives with
 * Stage C and gets its own branch then. An unknown language renders as plain
 * text rather than being highlighted with Go's rules, which would be confidently
 * wrong -- `#include` is not a comment and `nil` is not a keyword.
 *
 * @param {string} text @param {string} lang
 * @returns {Token[][]}
 */
export function tokenize(text, lang) {
  if (lang === 'go') return tokenizeGo(text);
  return String(text ?? '').split('\n').map((l) => (l ? [{ t: l, k: /** @type {Kind} */('id') }] : []));
}
