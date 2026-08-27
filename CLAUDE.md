# CLAUDE.md — working on Orrery

Read this before touching anything. It is the compressed version of ~46 planning
documents that live outside this repo (`../workshop/`), plus every trap the
first implementation actually hit.

---

## What this is, in five lines

An algorithm visualizer. Algorithms emit a **trace**: a flat, ordered list of
tiny reversible events. Renderers consume traces and know nothing about
algorithms. Every write records its old value as well as its new one, so
stepping backward is applying the old one. Every write also records *what was
read to produce it*, which is how plain-English explanations get generated with
no model involved.

---

## THE TWO INVARIANTS — do not break these

Everything in this codebase is downstream of two rules. If a change violates
one, the change is wrong, not the rule.

### I1 — local invertibility
> Every event carries enough information to be undone using **only itself**.
> `set` carries `from` and `to`. Forward writes `to`, backward writes `from`.
> No event may require scanning other events to be reversed.

This buys: O(distance) seeking, free rewind, zero snapshot memory, and a player
provable with two property tests.

**Enforced by** validator checks V4 and V6, and `TestRoundTrip` /
`TestSeekEquivalence` in `internal/replay/player_test.go`.

### I2 — consumer purity
> A renderer is a pure function of `(state, step, viewSpec)`.
> It may not import from `internal/algos`. It may not branch on `meta.algo`.
> Algorithm knowledge reaches renderers **as data in the trace**, never as code.

This buys: N algorithms + M views costs N+M work, not N×M.

**The one legitimate pressure valve** is `meta.views` — declarative render hints
the producer writes and the renderer reads. That is data, not code. If you find
yourself wanting `if (algo === 'dijkstra')` in a renderer, add a
`spec.options.*` key instead.

---

## Where things live

```
internal/trace/     THE FORMAT. stdlib-only — deps_test.go enforces that.
                    Types, Path, Value, State (the semantics of applying an
                    event), the validator, the step index, the state hash.
internal/tracer/    The recording API algorithms write against.
internal/replay/    The Go player. Exists to test the tracer and to prove the
                    JS player correct. Not a production path.
internal/algos/     32 algorithms. One file each, //go:embed of itself.
internal/gen/       Generate + Catalog. Shared by the CLI, the server and the
                    build, so all three emit byte-identical output for the
                    same inputs — which is what makes goldens mean anything.
internal/store/     Postgres: pgx pool, embedded migrations, sqlc queries.
internal/api/       The HTTP layer: config, cache key, router, handlers.
cmd/orrery/         CLI: trace | verify | hash | play | bench | complexity |
                    ls | catalog
cmd/orreryd/        HTTP server: /api/trace, /api/share, the trace cache.
                    Spec in ../workshop/BACKEND.md

web/src/lib/        validate (the trust boundary), value, explain
web/src/player/     state, steps, prepass, store  — mirrors internal/trace
web/src/render/     Linear, Grid, RecursionTree, TreeView, LinkedList, GraphView,
                    ArrayTree, Fallback, focus, layout/
web/src/ui/         shell, transport, code pane, explain pane, panes
```

**Dependency rule, enforced in CI:** `api → gen → algos → tracer → trace`.
Nothing points back. `internal/trace` imports only the standard library.

---

## Go version

`go.mod` declares `go 1.24` as a **floor**. Any newer toolchain builds it
unchanged; there is no pin and no toolchain download. Nothing in the code needs
more than Go 1.21.

Do not bump it without a reason. Raising the floor only removes reviewers who
have an older Go, and buys nothing until some feature actually requires it. CI
reads the version from `go.mod`, so the two cannot drift.

## Commands

```bash
make check      # what CI runs: vet + go test -race + conformance + JS tests
make test       # go test -race ./...
make conformance# Go player vs JS player, step by step, every golden trace
make webtest    # tidy-tree properties + tree topology + JS player tests
make traces     # regenerate traces/*.json + algorithms.json + complexity.json
make golden     # regenerate testdata/golden/*.orrery.json, THEN READ THE DIFF
make fuzz       # 60s on the decoder; it must never panic
make run        # the API server; needs DATABASE_URL, see .env.example
bash scripts/doctor.sh   # what is missing before you waste time on an error
```

`make check` must be green before any commit.

---

## THE TRAPS

Every one of these was hit for real during the first implementation. They are
in rough order of how much time they cost.

### 1. `omitempty` on a value field silently corrupts every DP table
`Event.From/To/V/Fill` are `any`. With `json:",omitempty"` a legitimate
`"from": 0` is dropped on encode, comes back as `nil`, and V4 compares nil
against 0 and fails on every DP table.

That is why `internal/trace/event.go` has **per-type marshalling**
(`initWire`, `setWire`, `callWire`, `retWire`) and a single permissive decode
target using `json.RawMessage`. Do not "simplify" it back.
Regression: `TestZeroValuesSurviveTheWire`.

### 2. Go and JavaScript disagree about how to print a number
Go's `%g` switches to exponent notation at a different threshold than
ECMA-262's `Number::toString`. `formatNum` in `internal/trace/value.go`
reimplements the spec's case analysis by hand so the two agree.

If you touch number formatting, `TestCanonMatchesJS` is what catches you —
and if `make conformance` ever fails with a step number and no obvious cause,
**suspect this first**.

### 3. `addrKey` is a cross-language contract
`Path.KeyWith` (Go) and `addrKey` (JS) must produce byte-identical output. The
state hash is built from these keys. Change one, change both, and run
`make conformance`.

### 4. Backward must unapply a group IN REVERSE ORDER
A grouped swap rewinds into a duplicated value otherwise: restoring `a[i]`
after `a[j]` has already been restored from it. This is the one place ordering
matters. Both players do it; `TestGroupsRewindInReverse` is the regression.

### 5. `applyForward` / `state.forward` must not allocate
Seeking is O(distance), so one scrubber drag applies thousands of events. An
allocation per apply turns that into GC pressure and a stuttering scrubber, and
by the time you notice, the pattern has spread through five files. Mutate in
place; `changed` is a Set mutated in place, never returned fresh.

### 6. Mutations never happen during render
The player store is mutable and React observes it through
`useSyncExternalStore`, which prevents tearing **only** if every mutation is
outside render, synchronous, and followed by a version bump. Violating this
produces subtle visual glitches, not loud errors. This is the sharpest edge in
the frontend.

### 7. `runtime.Caller` skip counts are hand-counted
`tracer.emit(skip, ...)` counts stack frames between the user's `Set()` and
itself. Adding a helper layer shifts every line number by a function, and the
symptom is a code pane highlighting the wrong line — which reads as a rendering
bug. `TestCallerLines` is the tripwire. `Array.Fill` stamps its own caller's
line for exactly this reason.

### 8. `*Ev` is invalidated by the next `Set`
It is a pointer into the tracer's event slice, which may reallocate. Never hold
one across another write. The chaining style makes misuse unnatural; that is
the only defence.

### 9. Layout runs on the UNION, never on current state
`tidyTree` is fed every node that will *ever* exist, and renderers draw the
subset that exists now. That is why nothing ever moves. If you find yourself
laying out from `state`, you have reintroduced the reflow bug that makes most
recursion-tree visualizers unwatchable.

### 10. The state hash walks UTF-8 BYTES, not code units
Indexing a Go string yields bytes, so `State.Hash` runs FNV over the UTF-8
encoding. The JS twin used `charCodeAt(i) & 0xff`, which agrees with that for
ASCII and for nothing else — one arrow glyph inside one trace value
desynchronised the two players from that step onward, and `make conformance`
reported a hash mismatch at a step number with no hint as to the cause.

`web/src/player/state.js` now encodes through `TextEncoder`. `bellman-ford`
writes non-ASCII edge labels on purpose so the conformance suite keeps checking
it, and `player.test.mjs` has a direct regression against a hand-rolled FNV over
an explicit byte list.

### 11. Tree walks must be iterative
A recursive first walk blows the JS stack on an unmemoized fib, whose call tree
has a spine thousands deep. Both walks in `tidyTree.js` use explicit stacks, and
`tidytree.test.mjs` tests a 5,000-deep spine.

---

## Conventions

- **Comments explain WHY, never what.** The code says what. If a comment
  restates the line below it, delete the comment. If a decision had a real
  alternative, name the alternative and say why it lost.
- **Every non-obvious constant gets a reason**, not just a value.
- **Numeric triggers, not "never".** Optimizations that are designed but not
  built (columnar encoding, replay checkpoints, canvas rendering, Barnes–Hut)
  each carry the measurement that would justify building them. Do not build
  them before that number is observed.
- **Go:** stdlib only in `internal/trace`. Typed accessors (`Int`, `Num`) whose
  panic names the address, never bare type assertions on `trace.Value`.
- **JS:** `// @ts-check` and JSDoc typedefs on module boundaries. Four npm
  packages total (react, react-dom, vite, @vitejs/plugin-react) — adding a
  fifth needs a reason. Layout algorithms are hand-written on purpose.
- **CSS:** one semantic colour, one meaning, everywhere. Amber = written this
  step. Cyan = read to produce it. Violet = a pointer. Green = settled. Rose =
  failed branch. Never use an accent for chrome.
- **Golden fixtures are the review signal.** A format change shows up as a diff
  across every committed fixture. `make golden` then **read the diff** — that is
  the feature, not the friction.

---

## Adding an algorithm

One file, and **no frontend change is needed**:

```go
//go:embed myalgo.go
var myalgoSrc string

func init() {
    algos.Register(algos.Spec{
        ID: "myalgo", Title: "...", Family: "...", Blurb: "one sentence",
        Inputs: []algos.InputSpec{{Name: "n", Kind: "int", Min: 1, Max: 10, Default: 5}},
        Defaults: algos.Args{"n": 5},
        Source: trace.Source{Path: "internal/algos/x/myalgo.go", Text: myalgoSrc, FirstLine: 1},
        Run: run,
    })
}
```

Then `make traces && make golden && make check`.

**Input bounds in `Inputs` are the security boundary.** Everything downstream
trusts them. Bounds are per-algorithm because trace size is a function of
COMPLEXITY, not input size — N-Queens caps at 8 while a DP grid happily takes
10×10.

**Does it need cursor structures?** If the algorithm is comparison-driven
(searching, most sorting) it performs few or no writes, and without aux scalar
cursors its trace is valid, well-formed and useless. `orrery bench <algo>` is
the detector: if steps do not grow with input size, cursors are missing.

Judgement call, and the format cannot make it for you: bubble sort's scan
pointers are level 1 (detail — the swaps are the algorithm), binary search's
are level 0 (they *are* the algorithm — filtering them leaves nothing).

---

## Adding a renderer family

1. Read `../workshop/RENDERERS/<FAMILY>.md` — it is already specified, including
   the layout algorithm, edge cases, scale limits and an acceptance checklist.
2. Implement the props contract in `RENDERERS/00-OVERVIEW.md` §1. Pure function.
3. Register it in `web/src/render/registry.js`.
4. Animation is a function of the DELTA shape (`from`/`to`/path), never of an
   event that says "this is a creation". The dispatch table is in
   `TRACE_FORMAT.md` §4.2.
5. Work the acceptance checklist before calling it done.

The tree renderer reuses `layout/tidyTree.js` completely unchanged. The linked
list does NOT, and `RENDERERS/LINKED_LIST.md` §1 says why: a list is a tree of
branching factor one, so tidy-tree layout runs happily and produces a vertical
column, which is wrong. Lists read left to right, so `layout/serpentine.js` is a
separate placement. What the two DO share is the layer below: `treeShape.js`
reads edges out of pointer fields, and "an edge is a ptr holding a ref" is the
same statement whatever shape it makes.

---

## What NOT to do

- Do not add a fifth event type. Four is a deliberate constraint; node
  structures are handled by widening the *address* to a path (ADR 0004).
- Do not put algorithm names in renderers (I2).
- Do not make the player immutable (ADR 0010 has the numbers).
- Do not add npm packages casually.
- Do not build the optimizations listed in `../workshop/FLAWS.md` §9 before
  their numeric trigger fires.
- Do not commit `web/public/traces/`, `algorithms.json` or `complexity.json` —
  they are generated.

---

## Current state

Stage A is built and green, plus C6 (the trace as a downloadable/droppable
file), B1 + B2 + B3 (tree, linked-list and graph renderers), C1/C2 (breakpoints
and watches), B4 (the array/tree duality), B6 (fifteen more algorithms), C3
(measured complexity) and C10 (the command palette). 32 algorithms, 7 renderer
families plus the call stack pane, CLI including a terminal player, Go↔JS
conformance over 1,172 step hashes.

Every `Spec` now declares `Complexity` and `Sweep`. `orrery complexity` runs
each algorithm across its sweep range at build time; `lib/complexity.js` fits a
model and shows it beside the claim. 26 of 31 agree (segtree declares no Sweep;
see the comment there). Of the five that do not, fib-naive measures 1.66^n
against a declared 2^n and N-Queens refuses to fit at all -- those two are the
interesting ones. The other three are Dijkstra, Bellman-Ford and Prim, and they
disagree for one shared reason worth knowing: their cost is in COMPARISONS,
which only become steps at detail level 1, while the measured curve counts
level-0 steps, which are writes.

E1 is built: `cmd/orreryd` serves `/api/algorithms`, `/api/trace`,
`/api/trace/{key}`, `/api/share`, `/api/share/{id}`, `/healthz` and `/readyz`,
over a Postgres trace cache and share table. Verified end to end: a trace
served from the API is byte-identical to the same trace from the CLI, because
both call `gen.Generate`.

Two things about it are worth knowing before changing it. The cache key hashes
the RESOLVED input, so `{}` and an explicit `{"n":6}` are one cache entry
rather than two — hashing the raw body would miss on the most common request
there is. And `middleware.RealIP` is deliberately NOT installed: it trusts the
leftmost `X-Forwarded-For`, which is the value a client controls, so E2's rate
limiter would silently inherit the bypass.

`player/breakpoints.js` is worth reading once: matching a breakpoint is a scan
over EVENTS, never a replay, because every `set` carries its full `to` rather
than a delta. That is why searching backward costs exactly what searching
forward costs, and it is the reversibility invariant paying for itself twice.

B3 is built. `render/layout/graphShape.js` is the topology and
`graphLayout.js` is the four placement strategies, chosen by PROVENANCE from
`schema.layoutHint` — grid for a maze, layered for a DAG, circle for anything
small, seeded Fruchterman–Reingold frozen at 300 iterations for the rest. Five
graph algorithms feed it, and between them they exercise every strategy and
every option: dijkstra, bfs-maze, dfs, kruskal, toposort.

Three things about it are worth knowing before changing it.

**A level-0 write may never read back a value only a level-1 write produced.**
The examining cursor started as a scalar parked inside the pop group at level
0; its `from` was the last node examined, which level-0 replay had never seen,
so rewinding restored a value out of thin air. `TestSeekEquivalence` caught it
on the first run. The aux precondition in ADR 0016 is necessary and not
sufficient — the structure must be written at ONE level only.

**Context is dimmed by colour, not by opacity.** `opacity` dims the labels
along with the discs and caps how much contrast they can reach: measured, pure
`--text` at 45% is 4.14:1 dark and 2.89:1 light, and the light theme needs 60%
before it clears AA. So the discs carry the opacity and the labels switch token
(`--text` → `--text-dim`). Same channel the code pane uses.

**Queue membership is declared, never inferred.** The first version fell back
to "has a finite distance and is not settled", which is true for Dijkstra and
quietly wrong for Kruskal — it writes a component label to every node before
its first decision, so the whole graph came out violet.

Not built: Stage B (spec in `../workshop/STAGE_B.md`) and E3 — the compile
queue, which is why `compile_jobs` is absent from the schema and the Stage B
fields are absent from Config. Config nothing reads is config nobody maintains,
and it reads as a half-built feature rather than an unbuilt one.

The tree renderer reuses `layout/tidyTree.js` unchanged; `render/layout/
treeShape.js` holds the topology, including the cycle breaking that keeps a
malformed tree from hanging the tab.

B4 is `alsoAs: "tree"` on a Linear view, and it is the cheapest feature in the
project relative to what it teaches. A heap and a segment tree are ARRAYS;
neither gets a `nodes` structure, because node identity would put a topology in
the trace that the algorithm never wrote. What they get is a second READING of
the same cells, with children at 2i+1 and 2i+2 -- arithmetic on an index, no
different in kind from a grid's `[r, c]`. `render/ArrayTree.jsx` reuses the tree
family's DOM and stylesheet unchanged, so "amber means written this step" has
one implementation. The toggle lives in the pane head rather than inside Linear,
which is both the right place for chrome and what keeps the two renderers from
importing each other.

`../workshop/IMPLEMENTATION_NOTES.md` is what changed when the design met real
code. `../workshop/FLAWS.md` is what is genuinely weak — §13 is the interview
rehearsal.
