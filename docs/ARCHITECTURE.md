# ARCHITECTURE

> **The one sentence.** Producers emit a reversible delta log; consumers replay it.
> Everything in this document is a consequence of that sentence.

---

## 1. Why this shape at all

The naive algorithm visualizer is written as: *algorithm calls `drawSwap(i, j)`*.
Every project on GitHub that does this dies the same death. Three symptoms:

1. **Every new algorithm needs renderer changes.** The renderer grows a special
   case per algorithm until it is 4,000 lines of `if (algo === 'dijkstra')`.
2. **Backward stepping is impossible.** A draw call has no inverse. So the
   project either has no rewind, or it re-runs the algorithm from step 0 on
   every backward press, which forces the algorithm to be re-entrant and
   deterministic anyway — at which point you have re-invented replay, badly.
3. **The explanation is hand-written per algorithm.** So most projects skip it,
   and the visualizer becomes a screensaver: pretty, teaches nothing.

Orrery inverts the dependency. The algorithm does not know a renderer exists.
It knows how to describe what it did. That description is the **trace**.

```
    ┌─────────────┐                      ┌─────────────┐
    │  PRODUCERS  │ ──── trace (JSON) ──▶│  CONSUMERS  │
    └─────────────┘                      └─────────────┘
     Go built-ins                          player
     user Go (Stage B)                     renderers
     user C++ (Stage C)                    explainer
     hand-written fixtures                 CLI / TUI
                                           conformance checker
```

The trace is a **format**, not a function call. That means it can be written to
a file, diffed, committed as a test fixture, validated by a separate binary,
version-negotiated, and produced by three different languages. It is the
project's actual engineering artifact — the renderers are its first client.

**This is also the honest answer to "why is this a systems project and not a
UI project."** The interesting problem here is protocol design under a hard
invertibility constraint, plus an untrusted-code compilation pipeline. The
React app is the demo surface for both.

### Alternatives that lost

| Alternative | Why it lost |
|---|---|
| Direct render callbacks | See the three deaths above. |
| Full state snapshot per step | Simple and correct, but O(steps × state) memory, no provenance (you can diff two snapshots to find *what* changed but never *why*), and a 10×10 DP over 200 steps is 20k cells copied for no reason. Snapshots also can't express "this was read", only "this differs". |
| Streaming events over a WebSocket while the algorithm runs | Needed only if traces were unbounded or the algorithm were long-running. Ours finish in microseconds. Streaming would forfeit the single largest advantage we have: **at render time we know the entire future**, which is what makes layout stable (§5). |
| Instrument at the VM level (delve, ptrace, debug adapter protocol) | Genuinely interesting and much more general. Rejected because it makes the browser story impossible and turns a 6-week project into a 6-month one. Noted in `BACKLOG.md`. |

---

## 2. The two invariants

Everything downstream is derived from exactly two rules. Memorize these; if a
proposed feature violates one, the feature is wrong, not the rule.

> **I1 — Local invertibility.**
> Every event carries enough information to be undone using only itself.
> `set` carries `from` and `to`. Forward writes `to`, backward writes `from`.
> No event may depend on scanning other events to be reversed.

> **I2 — Consumer purity.**
> A renderer is a pure function of `(state, stepIndex, viewSpec)`. It may not
> import from `internal/algos`. It may not branch on algorithm name.
> If it needs algorithm knowledge, that knowledge must arrive **as data in the
> trace**, never as code.

I1 buys: instant seek, free rewind, no snapshot memory, and a trivially
testable player (§7).
I2 buys: N algorithms × M renderers costs N + M work, not N × M.

**I2 has one legitimate pressure valve**, and it is important to state it
plainly because it looks like a violation: the trace carries a `meta.views`
block that *suggests* which renderer family suits which structure. That is
declarative data the renderer reads, not code it imports. Without it you need a
heuristic ("a 2-D structure is probably a grid") that will be wrong for
adjacency matrices, which are 2-D but want the graph renderer. See
`ADR/0012-view-hints.md`.

---

## 3. Component map

```
┌──────────────────────────────────────────────────────────────────────────┐
│ GO ENGINE  (module github.com/<you>/orrery)                              │
│                                                                          │
│  internal/algos/*      the built-in algorithms. Import tracer only.      │
│         │  calls                                                         │
│         ▼                                                                │
│  internal/tracer/      recording API. Ergonomic, allocation-light,       │
│         │              auto-captures source line via runtime.Caller.     │
│         │  builds                                                        │
│         ▼                                                                │
│  internal/trace/       THE FORMAT. Types, JSON codec, validator,         │
│         │              version negotiation. Zero dependencies.           │
│         │              *This package is the product.*                    │
│         ├──────────────▶ internal/replay/   Go-side player. Test-only.   │
│         │                                   Exists to prove the JS       │
│         │                                   player is correct (§7).      │
│         ▼                                                                │
│  internal/api/         HTTP. chi router.                                 │
│  internal/store/       pgx + sqlc. shares, trace cache, compile jobs.    │
│  internal/compile/     Stage B/C. Instrument → compile → artifact.       │
│                                                                          │
│  cmd/orrery            CLI: emit / validate / play traces in a terminal  │
│  cmd/orreryd           the server                                        │
└──────────────────────────────────────────────────────────────────────────┘
                                    │  trace JSON over HTTP
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ WEB APP  (Vite + React, no TypeScript, no state library)                  │
│                                                                          │
│  src/lib/validate.js   runtime schema check at the boundary. ONE place.  │
│         ▼                                                                │
│  src/player/index.js   Player: mutable state, forward/back/seek/play     │
│  src/player/prepass.js buildIndex(): steps, callTree, firstWrite,        │
│         │              structUnion, lineIndex.  Runs once at load.       │
│         ▼                                                                │
│  src/render/*          one module per renderer family. Pure. (I2)        │
│  src/ui/*              shell, transport, code pane, explain pane         │
└──────────────────────────────────────────────────────────────────────────┘
```

### Dependency rule, enforced

```
algos ──▶ tracer ──▶ trace
api, compile, store ──▶ trace
replay ──▶ trace
```

Nothing ever points the other way. `internal/trace` imports nothing outside the
Go standard library — that is checked in CI by a 6-line test that walks
`go list -deps`. Cheap, and it is the kind of thing that makes a reviewer trust
the rest of the codebase.

On the web side the same rule: `src/render/*` may import from `src/lib` and
receive props. It may not import from `src/player`. The player pushes state
down; renderers never reach up.

---

## 4. Data flow, end to end

### 4a. Built-in algorithm (Stage A — this is what ships first)

```
 user picks "LCS", types AGGTAB / GXTXAYB, presses Run
        │
        ▼
 POST /api/trace  {algo:"lcs", input:{a,b}, seed:0}
        │
        ├─▶ key = sha256(algo, canonical(input), seed, engineVersion)
        ├─▶ trace_cache hit?  ──yes──▶ return cached bytes (ETag, immutable)
        │                       no
        ▼
 registry.Lookup("lcs").Run(tracer, input)
        │  algorithm writes events as it computes
        ▼
 trace.Trace  ──▶ validate ──▶ gzip ──▶ store in trace_cache ──▶ HTTP 200
        │
        ▼
 browser: validate() ──▶ buildIndex() ──▶ new Player(trace, index)
        │
        ▼
 React subscribes via useSyncExternalStore; renderers draw state at step 0
```

**Note what is *not* here:** no WebSocket, no job queue, no polling. A built-in
trace is generated in under a millisecond. The whole Stage A backend is a
cache in front of a pure function.

### 4b. User code (Stage B)

```
 user pastes Go
        │
        ▼
 POST /api/compile {lang:"go", source}
        │  hash the source; artifact cache hit? → skip to bottom
        ▼
 AST gate: reject unsafe / cgo / go:embed / non-allowlisted imports  ── reject ─▶ 422 + line
        ▼
 go/types type-check (needed to know if x[i] is slice, array or map)  ── error ─▶ 422 + line
        ▼
 rewrite AST: writes become __tr.Set(name, path, old, new, expr, deps, line)
        ▼
 GOOS=js GOARCH=wasm go build   (container: no net, ro-rootfs, 512MB, 30s)
        ▼
 artifact .wasm  ──▶ 200 {jobId, wasmUrl}
        │
        ▼
 browser: Worker loads wasm_exec.js + .wasm, runs it, guest counts events,
          host watchdog kills at wall-clock cap
        ▼
 worker postMessage {trace}  ──▶ same validate/buildIndex/Player path as 4a
```

**The server never executes user code.** It parses it, rewrites it, and hands it
to `go build`. That is not zero-risk (`FLAWS.md` §7 enumerates the real attack
surface of a compile-only service — `//go:embed`, cgo LDFLAGS, compiler bombs)
but it removes the entire class of "your sandbox has a syscall escape."

---

## 5. The structural insight: we know the whole future

Because a trace is complete before the first frame is drawn, **layout is a batch
problem, not an online one.** This single observation solves three of the four
open problems in this project:

- **Trees don't jump.** Compute the layout of the *union of all nodes that will
  ever exist*, once, at load. Render only the subset that exists at step k.
  Nodes fade in at their final position. Zero relayout, zero jitter, by
  construction — not by damping or animation tricks.
- **Graphs are deterministic.** Run force-directed relaxation offline at load
  with a seeded PRNG, then freeze. Same seed → same picture, forever, including
  in a shared link.
- **Recursion trees can be navigated.** The full call tree is known, so you get
  a minimap and "jump to the node that computed this cell" for free.

This is called the **static skeleton** principle throughout these docs. It is
the biggest single reason to prefer batch traces over streaming, and it is the
thing to say out loud in an interview when someone asks "why not stream?".

Costs, stated honestly: the pre-pass is O(events) time and O(distinct addresses)
memory, and for a pathological trace (200k events over 200k distinct node ids)
it is the memory high-water mark of the whole app. Mitigation and measurement
threshold in `FRONTEND.md` §8.

---

## 6. Step vs. event — the granularity model

An **event** is a write. A **step** is what one press of `▶` advances.
They are not 1:1, and conflating them is the most common bug in this design.

```
events:  [init][set][set][call][set][set][ret][set]...
                └─g1─┘            └─g2─┘
steps:    0     1          2      3         4     5
```

- Reads and comparisons are never events. They ride along as `deps` on the
  write they caused. A 5×5 DP is 25 steps, not 400.
- Adjacent events sharing a non-zero group id `g` form **one** step. A swap is
  two writes and one step. Forward applies the whole range; backward unapplies
  it in reverse.
- The step index is a `[]Range` over the event array, computed once in the
  pre-pass. Seeking to step k means moving to `steps[k].end`.

**The known weak point:** binary search does O(log n) writes, and the *whole
point* of binary search is the comparisons, which are not writes. The fix is
**cursor structures** — see §6.1. It is a real fix but it requires discipline
from the algorithm author, and that is a genuine cost of this design. It is
written up as a flaw, not hidden. `FLAWS.md` §2.

### 6.1 Cursor structures — how a read becomes visible

If you want the user to *see* something that isn't a write, promote it to a
write on an auxiliary structure:

```go
lo := tr.Scalar("lo", 0)          // aux:true
mid := tr.Scalar("mid", -1)       // aux:true
...
mid.Set((lo.V()+hi.V())/2).Because("(lo + hi) / 2").From(lo.Ref(), hi.Ref())
```

Now the pointer moving *is* a step, with provenance, and the explanation writes
itself. The same mechanism gives you: two-pointer `i`/`j`, sliding-window
bounds, the current edge being relaxed in Dijkstra, the pivot in quicksort, and
the "currently comparing" highlight in any sort.

Aux structures are marked `aux:true` in their `init`. That flag is load-bearing:
it is what makes **detail levels** sound. See `ADR/0016-detail-levels.md`.

---

## 7. How correctness is proved

Three layers, cheapest first. All three are cheap because the format is small.

1. **Round-trip property test (Go).** For every golden trace:
   `forward to end, then backward to 0` ⇒ state is byte-identical to the
   initial state. This is I1, tested directly. ~20 lines, catches almost every
   tracer bug.
2. **Seek equivalence.** `state after seek(k)` == `state after k× next()`, for
   all k, for every golden trace. Catches group-boundary and pre-pass bugs.
3. **Cross-language conformance.** The Go replayer and the JS player must agree.
   CI runs `cmd/orrery hash --all-steps golden/*.json` and a Node script doing
   the same with the JS player, and diffs the hash streams. If the two players
   ever disagree about state at step 42, CI fails.

Layer 3 is the one that makes this look like a protocol project rather than a
toy, and it costs about 80 lines total. It is in Tier 1 for that reason.

Golden traces are committed under `testdata/golden/`. They double as the format
regression suite: any change to the encoder shows up as a diff in a checked-in
JSON file, which is exactly the review signal you want.

---

## 8. Deployment shape

```
        Cloudflare / Netlify            Fly.io or a single VPS
        ┌───────────────────┐           ┌──────────────────────────┐
        │  static web build │  /api/*   │  orreryd (Go, chi)       │
        │  (Vite output)    │ ────────▶ │   ├─ trace generation    │
        └───────────────────┘           │   ├─ share links         │
                                        │   └─ compile queue (B/C) │
                                        │  Postgres (pgx + sqlc)   │
                                        └──────────────────────────┘
```

Stage A works with the API turned off entirely — traces for built-ins can be
generated at build time and shipped as static JSON. **Do that first.** It means
the demo cannot break during an interview because a server is cold. The API
becomes necessary only for share links with arbitrary input, and for Stage B.
See `BACKEND.md` §2 for the "static-first, server-optional" argument.

---

## 9. What this architecture is bad at

Stated up front so it is not a surprise 40 minutes into a hostile interview.
Full treatment in `FLAWS.md`.

- **Long-running or unbounded algorithms.** Anything that isn't finished in
  milliseconds does not fit the batch model. Streaming would be a genuine
  redesign, not a feature.
- **Algorithms whose interesting behaviour is not writes.** Comparison-driven
  algorithms need deliberate cursor instrumentation. The design does not make
  this automatic and cannot.
- **Concurrency.** A trace is a total order. Goroutines produce a partial order.
  Visualizing concurrent algorithms would need vector clocks or lamport
  timestamps in the event, which is a v2 format. Explicitly out of scope.
- **In-place mutation of large objects.** Every write records `from`, so writing
  a 10k-element slice as a single value stores it twice. The format assumes
  writes are small and scalar-ish. There is no protection against this; it is a
  convention.

---

## 10. Cross-references

- Event spec, addressing, versioning → `TRACE_FORMAT.md`
- Go package contents and tracer API → `ENGINE.md`
- React tree, state ownership, perf → `FRONTEND.md`
- Palette, motion, wireframes → `UI_DESIGN.md`
- Per-family layout algorithms → `RENDERERS/`
- Every decision with its rejected alternative → `ADR/`
- Where this bends → `FLAWS.md`, `RISKS.md`
