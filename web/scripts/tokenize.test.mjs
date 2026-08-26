#!/usr/bin/env node
/**
 * Tokenizer tests.
 *
 * The property that matters is LOSSLESSNESS. The code pane renders tokens
 * instead of text, so a tokenizer that drops or duplicates a character silently
 * rewrites the source the user is reading -- and every `ln` in the trace points
 * into that source, so a dropped character is a code pane that disagrees with
 * the debugger about what line 62 says. It is checked against all 17 real
 * algorithm files rather than against fixtures.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenizeGo, tokenize } from '../src/lib/tokenize.js';

const DIR = fileURLToPath(new URL('../../testdata/golden/', import.meta.url));
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const sources = readdirSync(DIR).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')))
  .filter((t) => t.meta.source)
  .map((t) => ({ id: t.meta.algo, text: t.meta.source.text, lang: t.meta.lang }));

// --- THE property -----------------------------------------------------------
{
  let bad = [], lineMismatch = [], newlines = 0, tokens = 0;
  for (const s of sources) {
    const lines = s.text.split('\n');
    const out = tokenizeGo(s.text);
    if (out.length !== lines.length) lineMismatch.push(`${s.id}: ${out.length} vs ${lines.length}`);
    out.forEach((toks, i) => {
      tokens += toks.length;
      for (const tk of toks) if (tk.t.includes('\n')) newlines++;
      const rebuilt = toks.map((tk) => tk.t).join('');
      if (rebuilt !== lines[i]) bad.push(`${s.id} line ${i + 1}:\n    want ${JSON.stringify(lines[i])}\n    got  ${JSON.stringify(rebuilt)}`);
    });
  }
  check(`tokens rebuild every source character for character — ${sources.length} files, ${tokens} tokens`,
    bad.length === 0, bad[0] ?? '');
  check('one token array per source line', lineMismatch.length === 0, lineMismatch[0] ?? '');
  // A token containing a newline could not be drawn: the pane renders per line.
  check('no token spans a line break', newlines === 0, `${newlines} found`);
}

// --- state that must cross lines -------------------------------------------
{
  const src = 'a := 1\n/* start\nstill comment\nend */ b := 2\n';
  const out = tokenizeGo(src);
  check('a block comment keeps its kind across every line it covers',
    out[1].every((t) => t.k === 'com') && out[2].every((t) => t.k === 'com'),
    JSON.stringify(out[2]));
  // The whole reason this is whole-file and not per-line: a stateless
  // tokenizer restarts inside the comment and highlights its contents as live
  // code, so commented-out work looks like running work.
  check('and code after the terminator is code again',
    out[3].some((t) => t.k === 'id' && t.t === 'b'), JSON.stringify(out[3]));

  const raw = 'x := `line one\nline two` + y\n';
  const r = tokenizeGo(raw);
  check('a raw string keeps its kind across lines', r[1][0].k === 'str', JSON.stringify(r[1][0]));
  check('and code after the closing backtick is code again',
    r[1].some((t) => t.t === 'y' && t.k === 'id'), JSON.stringify(r[1]));
}

// --- string edge cases ------------------------------------------------------
{
  const t = tokenizeGo('s := "a\\"b" + c')[0];
  check('an escaped quote does not close the string',
    t.some((x) => x.k === 'str' && x.t === '"a\\"b"'), JSON.stringify(t));
  const u = tokenizeGo('s := "unterminated')[0];
  check('an unterminated string ends at the line rather than eating the file',
    u[u.length - 1].k === 'str' && tokenizeGo('s := "oops\nnext := 1')[1][0].k !== 'str',
    JSON.stringify(u));
}

// --- shapes -----------------------------------------------------------------
{
  const t = tokenizeGo('for i := 0; i < len(xs); i++ {')[0];
  const kind = (w) => (t.find((x) => x.t === w) || {}).k;
  check('keywords are keywords', kind('for') === 'kw');
  check('predeclared names read as keywords — shadowing len is legal and colouring it as a plain name would surprise more than it informs',
    kind('len') === 'kw');
  check('a plain name is an identifier', kind('i') === 'id');
  check('numbers are numbers', kind('0') === 'num');

  const call = tokenizeGo('v := place(r + 1)')[0];
  check('an identifier followed by ( is a call', (call.find((x) => x.t === 'place') || {}).k === 'fn');
  // Without the "immediately" rule, `if (x)` makes `if` a call.
  check('but a keyword before a paren is still a keyword',
    (tokenizeGo('if (x) {')[0].find((x) => x.t === 'if') || {}).k === 'kw');

  check('a // comment runs to end of line',
    tokenizeGo('x := 1 // and "this" is not a string')[0].filter((x) => x.k === 'str').length === 0);
}

// --- other languages --------------------------------------------------------
{
  const cpp = tokenize('#include <vector>\nint main(){}', 'cpp');
  check('a non-Go source is not highlighted with Go rules — #include is not a comment and nil is not a keyword there',
    cpp.every((line) => line.every((t) => t.k === 'id')), JSON.stringify(cpp[0]));
  check('and it is still lossless', cpp.map((l) => l.map((t) => t.t).join('')).join('\n') === '#include <vector>\nint main(){}');
  check('an empty source survives', tokenize('', 'go').length === 1);
}

console.log(failures === 0 ? '\ntokenize: all checks passed' : `\ntokenize: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
