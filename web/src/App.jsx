// @ts-check
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { validate, hasErrors } from './lib/validate.js';
import { parseTraceFile, traceFilename, MAX_FILE_BYTES } from './lib/tracefile.js';
import { buildIndex } from './player/prepass.js';
import { PlayerStore } from './player/store.js';
import { usePlayerVersion } from './player/usePlayer.js';
import { useTraceFile, downloadTrace } from './ui/useTraceFile.js';

import TopBar from './ui/TopBar.jsx';
import Transport from './ui/Transport.jsx';
import ViewGrid from './ui/ViewGrid.jsx';
import CodePane from './ui/CodePane.jsx';
import ExplainPane from './ui/ExplainPane.jsx';
import CallStackPane from './ui/CallStackPane.jsx';
import Banner from './ui/Banner.jsx';
import EmptyState from './ui/EmptyState.jsx';
import Shortcuts from './ui/Shortcuts.jsx';
import { useKeys } from './ui/useKeys.js';

const BASE = import.meta.env.BASE_URL ?? '/';

/**
 * App owns the three stores described in FRONTEND.md 3, split by MUTATION
 * FREQUENCY AND SIZE rather than by feature:
 *
 *   player  -- mutable, changes up to 60x/sec, holds the whole algorithm state
 *   view    -- tiny, immutable, ordinary React state (focus, panes)
 *   session -- tiny, in the URL (which algorithm, which step)
 *
 * That split is the whole state-management design. There is no library.
 */
export default function App() {
  const [catalog, setCatalog] = useState/** @type {any[]} */([]);
  const [algo, setAlgo] = useState(() => readHash().algo);
  const [loadState, setLoadState] = useState({ status: 'idle', diags: [], error: '' });
  const [store, setStore] = useState(/** @type {PlayerStore|null} */(null));
  const [trace, setTrace] = useState(/** @type {any} */(null));
  const [focus, setFocus] = useState(/** @type {any} */(null));
  const [pinned, setPinned] = useState(false);
  const [theme, setTheme] = useState('dark');
  const [showKeys, setShowKeys] = useState(false);
  const [offline, setOffline] = useState(false);
  // Set only when the loaded trace came from a file. It and `algo` are mutually
  // exclusive: one of them names where the current trace came from, and a
  // dropped file has no catalogue id and therefore no URL to be shared by.
  const [fileName, setFileName] = useState('');
  const wantStep = useRef(readHash().step);
  // The bytes the current trace arrived as, kept so that downloading it hands
  // back the producer's file rather than a re-encoding. See downloadTrace.
  const rawText = useRef('');

  const version = usePlayerVersion(store);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  // --- catalogue ------------------------------------------------------------
  useEffect(() => {
    fetch(`${BASE}algorithms.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setCatalog)
      .catch(() => setOffline(true));
  }, []);

  // --- trace ----------------------------------------------------------------
  /**
   * Everything a validated trace has to do to become the thing on screen.
   *
   * Shared by the two ways in -- fetching a built-in and opening a file -- so
   * that a dropped trace is not a second-class citizen running a slightly
   * different code path. The only thing the callers do differently is decide
   * what counts as valid, and both use the same validator to decide it.
   */
  const adopt = useCallback((raw, text, label, diags) => {
    const index = buildIndex(raw, 0);
    const s = new PlayerStore(raw, index, 0);
    // Tear down the previous store's timers, or a play loop keeps ticking
    // against a store nothing is rendering any more.
    setStore((old) => { old?.dispose?.(); return old; });
    if (wantStep.current > 0) { s.seek(wantStep.current); wantStep.current = 0; }
    rawText.current = text;
    setTrace(raw);
    setStore(s);
    setFocus(null);
    setPinned(false);
    setLoadState({ status: 'ok', diags, error: '' });
    if (import.meta.env.DEV) {
      console.info(`[orrery] ${label}: pre-pass ${index.stats.ms.toFixed(1)}ms, ` +
        `${index.stats.events} events, ${index.stats.steps} steps, ${index.stats.calls} calls`);
    }
  }, []);

  const load = useCallback(async (id) => {
    setLoadState({ status: 'loading', diags: [], error: '' });
    try {
      // Static first. The twelve built-ins ship as JSON next to the bundle, so
      // the demo works with the API down, on a plane, and -- the case that
      // actually matters -- while a free-tier container is cold-starting.
      const res = await fetch(`${BASE}traces/${id}.json`);
      if (!res.ok) throw new Error(`could not load ${id} (${res.status})`);
      // .text() rather than .json(): the exact bytes are what "download" gives
      // back, and re-encoding the parsed object is not identity. See
      // downloadTrace in ui/useTraceFile.js for why.
      const text = await res.text();
      const raw = JSON.parse(text);

      // THE TRUST BOUNDARY. Everything downstream assumes a valid trace.
      const diags = validate(raw);
      if (hasErrors(diags)) {
        setStore(null);
        setTrace(null);
        setLoadState({ status: 'invalid', diags, error: '' });
        return;
      }
      adopt(raw, text, id, diags);
    } catch (err) {
      setStore(null);
      setLoadState({ status: 'error', diags: [], error: String(err && err.message) });
    }
  }, [adopt]);

  /**
   * The other way in: a file, from the drop handler or the open button.
   *
   * A file is the least trusted input the app takes -- nothing about it came
   * from our own producer -- so the size check happens before anything reads
   * it, and the validator's findings are rendered rather than summarised.
   */
  const openFile = useCallback(async (file) => {
    setLoadState({ status: 'loading', diags: [], error: '' });
    setAlgo('');
    setFileName(file.name);
    // Checked here against the real byte count as well as inside
    // parseTraceFile, because .text() on a 2GB file is the hang we are
    // avoiding and by then it is too late to be clever about it.
    if (file.size > MAX_FILE_BYTES) {
      setStore(null);
      setTrace(null);
      setLoadState({
        status: 'error', diags: [],
        error: `${file.name} is ${(file.size / (1 << 20)).toFixed(1)} MiB, over the ` +
          `${MAX_FILE_BYTES >> 20} MiB cap a tracer runs under`,
      });
      return;
    }
    try {
      const text = await file.text();
      const res = parseTraceFile(text);
      if (!res.ok) {
        setStore(null);
        setTrace(null);
        setLoadState(res.error
          ? { status: 'error', diags: [], error: res.error }
          : { status: 'invalid', diags: res.diags, error: '' });
        return;
      }
      // A deep link's step belongs to the algorithm that link named, not to
      // whatever file happens to be dropped next.
      wantStep.current = 0;
      adopt(res.trace, text, file.name, res.diags);
    } catch (err) {
      setStore(null);
      setTrace(null);
      setLoadState({ status: 'error', diags: [], error: String(err && err.message) });
    }
  }, [adopt]);

  const dragging = useTraceFile(openFile);

  const save = useCallback(() => {
    if (trace && rawText.current) downloadTrace(rawText.current, traceFilename(trace, fileName));
  }, [trace, fileName]);

  useEffect(() => {
    if (!algo) return;
    // Picking from the catalogue supersedes a dropped file; leaving the name up
    // would credit the wrong source for what is on screen.
    setFileName('');
    load(algo);
  }, [algo, load]);

  // --- session in the URL ---------------------------------------------------
  useEffect(() => {
    const onPop = () => {
      const h = readHash();
      wantStep.current = h.step;
      setAlgo(h.algo);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    // A dropped file is not addressable: the recipient of the link does not
    // have the file. Leaving the previous algorithm's hash up would hand out a
    // link that silently loads something else, which is worse than no link.
    if (fileName && window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname);
      return;
    }
    if (!algo || !store) return;
    const step = store.step;
    const hash = step > 0 ? `#a=${algo}&s=${step}` : `#a=${algo}`;
    if (window.location.hash !== hash) {
      window.history.replaceState(null, '', hash);
    }
  }, [algo, fileName, store, version]);

  useKeys(store, {
    onHelp: () => setShowKeys((v) => !v),
    onFit: () => setFocus(null),
  });

  const setFocusIfUnpinned = useCallback((f) => {
    setFocus((cur) => (pinned ? cur : f));
  }, [pinned]);

  const togglePin = useCallback((f) => {
    setPinned((p) => {
      if (p) { setFocus(null); return false; }
      setFocus(f);
      return true;
    });
  }, []);

  // ------------------------------------------------------------------ render
  if (!algo && !fileName) {
    return (
      <div className="app">
        <TopBar catalog={catalog} algo={null} onPick={setAlgo}
                theme={theme} onTheme={setTheme} onHelp={() => setShowKeys(true)}
                onOpen={openFile} />
        <EmptyState catalog={catalog} onPick={setAlgo} offline={offline} onOpen={openFile} />
        <div className="transport" />
        {showKeys && <Shortcuts onClose={() => setShowKeys(false)} />}
        {dragging && <DropOverlay />}
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar catalog={catalog} algo={algo} onPick={setAlgo} trace={trace}
              theme={theme} onTheme={setTheme} onHelp={() => setShowKeys(true)}
              fileName={fileName} onOpen={openFile} onSave={store ? save : null} />

      {loadState.status === 'error' && (
        <Banner kind="err" title="Couldn't load that trace">
          {loadState.error}. The other built-in algorithms may still work.
        </Banner>
      )}

      <div className="workspace">
        <div className="panes">
          {trace?.meta?.truncated && <TruncationBanner trace={trace} onPick={setAlgo} />}
          {loadState.status === 'invalid'
            ? <InvalidTrace diags={loadState.diags} />
            : <ViewGrid store={store} trace={trace} version={version}
                        focus={focus} onFocus={setFocusIfUnpinned} onPin={togglePin} />}
        </div>

        <aside className="sidepanel">
          <ExplainPane store={store} version={version} />
          <CodePane store={store} trace={trace} version={version} />
          <CallStackPane store={store} version={version}
                         focus={focus} onFocus={setFocusIfUnpinned} />
        </aside>
      </div>

      <Transport store={store} version={version} />
      {showKeys && <Shortcuts onClose={() => setShowKeys(false)} />}
      {dragging && <DropOverlay />}
    </div>
  );
}

/**
 * Shown only while a file is over the window. It is chrome, so it is built from
 * surface and border tokens rather than an accent -- amber means "written this
 * step" everywhere in this app, and spending it on a drop target is exactly the
 * kind of erosion that stops the palette meaning anything. CLAUDE.md,
 * conventions.
 */
function DropOverlay() {
  return (
    <div className="dropzone" aria-hidden="true">
      <div className="dropzone-card">
        <div className="t">Drop to play it</div>
        <div className="m">.orrery.json — validated before it reaches the player</div>
      </div>
    </div>
  );
}

/**
 * Truncation is a TEACHING MOMENT, not an error: the partial trace is valid and
 * playable, and the banner explains what the cap actually means. The "try the
 * memoized version" hint is a heuristic, it lives here rather than in the
 * format, and it is allowed to be wrong. TRACE_FORMAT.md 8.
 */
function TruncationBanner({ trace, onPick }) {
  const memoized = trace.meta.algo?.replace('-naive', '-memo');
  const suggest = memoized && memoized !== trace.meta.algo;
  return (
    <Banner title={`Stopped at ${trace.meta.counts.events.toLocaleString()} events`}>
      This run hit the {trace.meta.truncatedReason} cap. That is the point —
      the picture below is what exponential looks like.
      {suggest && <> <button onClick={() => onPick(memoized)}>Try the memoized version →</button></>}
    </Banner>
  );
}

function InvalidTrace({ diags }) {
  return (
    <div className="pane"><div className="pane-body">
      <h2 style={{ marginTop: 0 }}>This trace isn&apos;t valid</h2>
      <p className="pane-note">
        The validator runs on every trace before it reaches the player. These
        are its findings.
      </p>
      <div className="dlg">
        {diags.map((d, i) => (
          <div key={i} className="diag" data-sev={d.severity}>
            {d.check} {d.event >= 0 ? `event ${d.event}` : ''} — {d.message}
          </div>
        ))}
      </div>
    </div></div>
  );
}

function readHash() {
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return { algo: h.get('a') || '', step: Number(h.get('s') || 0) };
}
