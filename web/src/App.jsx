// @ts-check
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { validate, hasErrors } from './lib/validate.js';
import { buildIndex } from './player/prepass.js';
import { PlayerStore } from './player/store.js';
import { usePlayerVersion } from './player/usePlayer.js';

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
  const wantStep = useRef(readHash().step);

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
  const load = useCallback(async (id) => {
    setLoadState({ status: 'loading', diags: [], error: '' });
    try {
      // Static first. The twelve built-ins ship as JSON next to the bundle, so
      // the demo works with the API down, on a plane, and -- the case that
      // actually matters -- while a free-tier container is cold-starting.
      const res = await fetch(`${BASE}traces/${id}.json`);
      if (!res.ok) throw new Error(`could not load ${id} (${res.status})`);
      const raw = await res.json();

      // THE TRUST BOUNDARY. Everything downstream assumes a valid trace.
      const diags = validate(raw);
      if (hasErrors(diags)) {
        setStore(null);
        setTrace(null);
        setLoadState({ status: 'invalid', diags, error: '' });
        return;
      }
      const index = buildIndex(raw, 0);
      const s = new PlayerStore(raw, index, 0);
      // Tear down the previous store's timers, or a play loop keeps ticking
      // against a store nothing is rendering any more.
      setStore((old) => { old?.dispose?.(); return old; });
      if (wantStep.current > 0) { s.seek(wantStep.current); wantStep.current = 0; }
      setTrace(raw);
      setStore(s);
      setFocus(null);
      setPinned(false);
      setLoadState({ status: 'ok', diags, error: '' });
      if (import.meta.env.DEV) {
        console.info(`[orrery] ${id}: pre-pass ${index.stats.ms.toFixed(1)}ms, ` +
          `${index.stats.events} events, ${index.stats.steps} steps, ${index.stats.calls} calls`);
      }
    } catch (err) {
      setStore(null);
      setLoadState({ status: 'error', diags: [], error: String(err && err.message) });
    }
  }, []);

  useEffect(() => { if (algo) load(algo); }, [algo, load]);

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
    if (!algo || !store) return;
    const step = store.step;
    const hash = step > 0 ? `#a=${algo}&s=${step}` : `#a=${algo}`;
    if (window.location.hash !== hash) {
      window.history.replaceState(null, '', hash);
    }
  }, [algo, store, version]);

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
  if (!algo) {
    return (
      <div className="app">
        <TopBar catalog={catalog} algo={null} onPick={setAlgo}
                theme={theme} onTheme={setTheme} onHelp={() => setShowKeys(true)} />
        <EmptyState catalog={catalog} onPick={setAlgo} offline={offline} />
        <div className="transport" />
        {showKeys && <Shortcuts onClose={() => setShowKeys(false)} />}
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar catalog={catalog} algo={algo} onPick={setAlgo} trace={trace}
              theme={theme} onTheme={setTheme} onHelp={() => setShowKeys(true)} />

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
