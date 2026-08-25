# TRACE FORMAT v1

> This is the spec. It is the only document that other documents are not allowed
> to contradict. If code and this file disagree, this file is right and the code
> is a bug.

**Media type:** `application/vnd.orrery.trace+json`
**File extension:** `.orrery.json`
**Canonical validator:** `orrery verify <file>` (see `ENGINE.md` §6)

---

## 0. Design constraints, so the shape makes sense

Four constraints produced every decision below.

| # | Constraint | Consequence |
|---|---|---|
| C1 | Every event must be undoable from itself alone | `set` carries `from` *and* `to`. No "delete last element" style events. |
| C2 | Renderers may not import from algorithms | Structure semantics must be declared as data in `init`. |
| C3 | Explanations must be generated, never AI-written | Every write carries `expr` + `deps` (what was read, and its value at read time). |
| C4 | Traces are diffed, committed, and version-negotiated | Stable key order, small keys, integer version, additive-change policy. |

---

## 0.5 Amendments to the locked spec — every deviation, in one place

The architecture was handed down locked. It was stress-tested, not redesigned.
These are **all** the places this spec differs from what was locked, each with
its reason. Nothing else changed.

| # | Locked | Here | Why |
|---|---|---|---|
| 1 | event `return` | event **`ret`** | wire compactness only; 200k events x 3 bytes. Purely cosmetic — rename if you prefer the long form |
| 2 | `set(name, **index**, ...)` where index is integers | `set(name, **at**, ...)` where `at` is a **path** of integers and strings | the only way node-based structures avoid a second event family. `[3,4]` is still a valid path, so grid/array events serialize **identically**. ADR 0004 |
| 3 | no line reference | **`ln`** on every event | the product shows code beside the visualization; without a per-event line the code pane cannot highlight anything and the feature dies silently. Free via `runtime.Caller` and AST positions. `FLAWS.md` §5 |
| 4 | one write = one step, always | **`g`** groups adjacent events into one step | a swap is two writes and one conceptual step. A half-swap on screen reads as a bug in the visualizer. ADR 0020 |
| 5 | no granularity control | **`lvl`** + **`aux`** on `init` | one trace, a granularity dial, instead of two traces that drift. Sound only because `lvl > 0` is restricted to aux structures — proof in §13. ADR 0016 |
| 6 | `expr` / `deps` on `set` | also on **`ret`** | without them a memo hit is indistinguishable from a computed return, and the memo-hit citation edge — the flagship — is not derivable without algorithm-specific code |
| 7 | (unspecified) | **`note`** on every event | phase narration with no expression: "partitioning around pivot 7" |
| 8 | (unspecified) | **`meta.views`** | something must decide that `dp` is a grid. Declared as data, so renderers stay pure. ADR 0012 |
| 9 | hard stop at 200k events | 200k events **plus** an 8 MiB byte cap **plus** a wall-clock cap | an empty infinite loop emits zero events and would sit under the event cap forever. Only the host can catch it. ADR 0014 |
| 10 | input max 10x10 | **per-algorithm** input bounds in `Spec.Inputs` | 10x10 bounds the *input*, not the trace. N-Queens on 10x10 has a call tree in the hundreds of thousands of nodes. `FLAWS.md` §3 |

Everything else — the trace-centric design, four event types, `from`/`to`
reversibility, pure replay with no snapshots, one step = one write, truncation
as a teaching moment, seeded reproducibility, the three stages, the eight
renderer families, and the flagship — is as locked.

---

## 1. Envelope

```jsonc
{
  "v": 1,
  "meta": { ... },
  "events": [ ... ]
}
```

Exactly three top-level keys. `v` is an integer, not a semver string, because
consumers do integer comparison and nothing else (§9).

### 1.1 `meta`

```jsonc
{
  "algo":    "lcs",                       // registry id, stable, [a-z0-9_-]+
  "title":   "Longest Common Subsequence",
  "lang":    "go",                        // go | cpp | fixture
  "input":   { "a": "AGGTAB", "b": "GXTXAYB" },
  "seed":    0,                           // 0 = input was not random
  "source":  {
    "path": "internal/algos/dp/lcs.go",
    "text": "package dp\n\nfunc LCS(...)...",   // the code the CODE PANE shows
    "firstLine": 1                         // text[0] corresponds to this line no.
  },
  "views":   [ ... ],                     // §7 - declarative render hints
  "counts":  { "events": 143, "steps": 96, "structs": 3 },
  "truncated": false,                     // true if a cap fired (§8)
  "truncatedReason": "",                  // "events" | "bytes" | "wall"
  "engine":  "orrery/0.3.1",
  "createdAt": "2026-08-14T09:12:00Z"
}
```

`source.text` is mandatory and is the *original* source, never the instrumented
rewrite. For built-ins it comes from `//go:embed`. For Stage B it is the user's
paste, verbatim. Every event's `ln` indexes into this text. See `STAGE_B.md` §5.

### 1.2 `events`

A flat, ordered array. Index into this array is the **event index**, and it is
a stable identifier used by the pre-pass, by call-tree node ids, and by deep
links. Never reorder events for any reason.

---

## 2. The four event types

There are four. Adding a fifth requires an ADR and a version bump discussion.
The whole design pressure of this project has been to *not* add a fifth, and
§4 explains how node-based structures avoid needing one.

| `t` | Meaning | Reversible because |
|---|---|---|
| `init` | a structure comes into existence | backward: structure ceases to exist |
| `set` | one cell/field takes a new value | backward: write `from` |
| `call` | a function is entered | backward: pop the stack |
| `ret` | a function returns | backward: push the frame back |

### 2.1 Common fields

Present on every event. All optional except `t`.

```jsonc
{
  "t":    "set",      // required
  "ln":   42,         // 1-based line in meta.source.text. 0 = unknown.
  "g":    0,          // group id. 0 = ungrouped. Adjacent equal g>0 = one step.
  "lvl":  0,          // detail level. 0 = essential. >0 only on aux structs.
  "note": ""          // plain-English override/addendum for the explain pane
}
```

`ln` was **not** in the original locked spec and is being added deliberately.
The product shows code alongside the visualization; without a per-event line
reference that pane cannot highlight anything, and the feature silently dies.
See `FLAWS.md` §5. It is free for built-ins (`runtime.Caller`) and free for
Stage B (AST positions), so there is no reason to omit it.

### 2.2 `init`

```jsonc
{
  "t": "init",
  "s": "dp",                       // structure name, unique within the trace
  "kind": "grid",                  // array | grid | map | nodes | graph | scalar
  "dims": [7, 8],                  // kind-dependent, see table
  "fill": 0,                       // initial value for every cell
  "aux": false,                    // true = display-only, never read by the algorithm
  "labels": {                      // optional, purely cosmetic
    "rows": ["", "A", "G", "G", "T", "A", "B"],
    "cols": ["", "G", "X", "T", "X", "A", "Y", "B"]
  },
  "schema": { ... }                // required for kind=nodes|graph, see §4
}
```

| `kind` | `dims` | addressed by | typical renderer |
|---|---|---|---|
| `scalar` | absent | `[]` | inline chip / cursor |
| `array` | `[n]` | `[i]` | Linear |
| `grid` | `[rows, cols]` | `[r, c]` | Grid |
| `map` | absent | `[key]` (string) | Fallback / Linear |
| `nodes` | absent | see §4 | Linked list / Tree |
| `graph` | absent | see §4 | Graph |

**Structures may be created mid-trace.** A memo table that only exists after the
first recursive call gets its `init` at that point, and the renderer's pane
appears at that step. This is why `init` is an event and not a header block -
it has a position in time.

### 2.3 `set` - the important one

```jsonc
{
  "t": "set",
  "s": "dp",
  "at": [3, 4],                     // the PATH. §3.
  "from": 0,
  "to": 7,
  "expr": "1 + dp[2][3]",           // display string, shown verbatim
  "deps": [                         // what was read, and its value when read
    { "s": "dp", "at": [2, 3], "v": 6 }
  ],
  "ln": 42
}
```

`from` and `to` are JSON values (§5). `from` must equal the structure's current
value at `at`; a validator checks this by replaying (§10, check V4). That check
is what turns a whole class of tracer bugs into a loud CI failure instead of a
subtly wrong rewind three weeks later.

A `set` whose `from` deep-equals `to` is legal but discouraged; the validator
emits a warning, because it is almost always a bug in the algorithm's
instrumentation and it produces a step where nothing visibly happens.

### 2.4 `call`

```jsonc
{
  "t": "call",
  "fn": "lcs",
  "args": [ {"n": "i", "v": 3}, {"n": "j", "v": 4} ],
  "ln": 20
}
```

**The call has no `id` field, on purpose.** Its identity is its event index.
That is stable, gapless, monotonic, and free. Deriving it costs nothing and
storing it would be 200k redundant integers. The parent of a call is whatever
call is on top of the stack when it is emitted - the player already tracks that,
so the call tree is reconstructed in the pre-pass with a single stack pass.

### 2.5 `ret`

```jsonc
{
  "t": "ret",
  "v": 7,
  "expr": "memo[3][4]",             // amendment to the locked spec - see below
  "deps": [ {"s": "memo", "at": [3,4], "v": 7} ],
  "ln": 22
}
```

**Amendment to the locked spec: `ret` gains `expr` and `deps`.**
Reason: without them you cannot distinguish "returned 7 after computing it" from
"returned 7 because it was already memoized," and that distinction *is* the
flagship feature. With `deps` on `ret`, a memo hit is recognisable structurally -
a `call` immediately followed by a `ret` whose deps point at the memo structure -
and the recursion-tree renderer can draw the dashed citation edge back to the
node that originally computed that cell, with no algorithm-specific code. This
preserves I2 and costs two optional fields. See `RENDERERS/RECURSION_TREE.md` §4.

`ret` with no matching open `call` is invalid (check V5).

---

## 3. Addressing: `at` is a path

The locked spec said `set(name, index, ...)` with an integer index. That is
widened - **not redesigned** - to a path.

```
at  ::=  [ ]                      the structure itself (scalar)
      |  [ seg, seg, ... ]
seg ::=  integer                  array index / grid coordinate / list position
      |  string                   map key, node id, or field name
```

**Grid and array events serialize identically to before.** `[3, 4]` was already
a valid path. This widening is backward compatible by construction, which is the
entire reason to choose it over introducing a parallel address type.

Reserved first segments (a node id may not begin with `$`):

| Segment | Namespace |
|---|---|
| `"$refs"` | named pointers into a `nodes`/`graph` structure: `head`, `slow`, `curr` |
| `"$edges"` | edges of a `graph`: `["$edges", "a|b", "w"]` |

**Address key** (used as a Map key in the pre-pass and for cross-highlighting):
the structure name, a space, then the path segments joined by `/` with integers
rendered in base 10. Documented here because two independent implementations
(Go and JS) must produce the same key for the conformance suite to work.

### Why a path and not a new event family

The alternative - `node`, `edge`, `link`, `unlink` events - was seriously
considered and rejected. Reasons:

1. **It multiplies the invariant surface.** Four event types each need a proven
   inverse. Eight need eight. `link`/`unlink` pairs are exactly the kind of
   thing that goes subtly wrong on rewind through a rotation.
2. **A path already expresses everything those events express.**
   `link(a, "next", b)` *is* `set list["a"]["next"] from null to {$:b}`, with
   the old pointer recorded - which `link` would have to carry anyway to be
   invertible, at which point it is a `set` with a worse name.
3. **Topology should be derived from state, not asserted by events.** If events
   assert topology, the two can disagree after a rewind. If the renderer walks
   the declared pointer fields of current state, there is one source of truth
   and rewind correctness is inherited from `set`.
4. Grid/array wire compatibility, above.

Full record: `ADR/0004-paths-not-node-events.md`.

---

## 4. Node-based structures

### 4.1 Declaration

```jsonc
{
  "t": "init", "s": "list", "kind": "nodes",
  "schema": {
    "fields": { "val": "scalar", "next": "ptr", "prev": "ptr" },
    "refs":   ["head", "tail", "slow", "fast"],
    "label":  "val",             // which field renders inside the node
    "order":  ["prev", "next"]   // child draw order, for deterministic layout
  }
}
```

```jsonc
{
  "t": "init", "s": "g", "kind": "graph",
  "schema": {
    "nodes":    ["a","b","c","d","e"],   // full node set, known up front
    "directed": false,
    "weighted": true,
    "edges":    [ ["a","b",4], ["a","c",2], ["b","c",1] ],
    "refs":     ["u", "cur"],
    "layoutHint": "force"        // force | circle | layered | grid
  }
}
```

Field kinds: `scalar` (a displayable value), `ptr` (a node reference - the
renderer draws an edge), `set` (a list of node refs - adjacency).
`ptr` is what makes topology derivable: **the renderer's edge set is exactly
the set of triples (n, f, v) where n is a node, f is a ptr field, and
v = state[n][f] is not null.**

For `kind:"graph"` the node and edge sets are declared statically because a
Dijkstra graph does not gain nodes mid-run; declaring them lets the layout be
computed once, before the first frame. If an algorithm genuinely builds a graph
incrementally, use `kind:"nodes"` with a `set` field instead.

### 4.2 The six node operations, all as `set`

| Operation | Event |
|---|---|
| create node `n3` with val 9 | `set list ["n3"] from null to {"val":9,"next":null,"prev":null}` |
| write a field | `set list ["n3","val"] from 9 to 12` |
| link | `set list ["n3","next"] from null to {"$":"n5"}` |
| unlink | `set list ["n3","next"] from {"$":"n5"} to null` |
| delete node | `set list ["n3"] from {...} to null` |
| move a named pointer | `set list ["$refs","slow"] from {"$":"n1"} to {"$":"n2"}` |
| relax a graph edge weight | `set g ["$edges","a|b","w"] from 7 to 5` |

The renderer decides how to *animate* these purely from the shape of the delta.
No event tells it "this is a creation." It derives it:

| `at` shape | `from` | `to` | Animation |
|---|---|---|---|
| `[nodeId]` | `null` | object | **enter** - fade + scale from 0.85 |
| `[nodeId]` | object | `null` | **exit** - fade + scale to 0.85, then cull |
| `[nodeId, ptrField]` | `null`/ref | ref | **edge draw** - stroke-dashoffset sweep |
| `[nodeId, ptrField]` | ref | `null` | **edge erase** - reverse sweep |
| `[nodeId, scalarField]` | any | any | **value flash** - amber, 120ms |
| `["$refs", name]` | ref | ref | **pointer glide** - 240ms translate |

This table is repeated in `RENDERERS/00-OVERVIEW.md`, and it is the reason no
`node`/`edge` event family is needed. Animation is a function of the delta.

### 4.3 Node id conventions

Node ids are opaque strings, but the tracer should generate them so that
**id order equals creation order** (`n0`, `n1`, `n2`, ...). Two consumers rely on
this being at least *stable*, never on it being meaningful:

- deterministic tie-breaking in layout (equal-depth siblings sort by id)
- reproducible force-directed initial placement

For values parsed from LeetCode array notation the ids are `n<arrayIndex>` of
the *dense* position, so that `[1,2,null,3,4]` produces `n0,n1,n3,n4`, and the
gap is itself informative when debugging. See `RENDERERS/TREE.md` §2.

---

## 5. Values

A JSON value that is one of:

```
null | boolean | number | string
| { "$": "<nodeId>" }              node reference
| { <field>: <value>, ... }        record (node payload only)
| [ <value>, ... ]                 tuple (e.g. a pair, a small fixed list)
```

Rules:

- `{"$": ...}` is reserved. A record may not have a `$` key.
- Numbers are IEEE-754 doubles on the wire. **Integers beyond 2^53 are not
  supported.** Encode them as strings if you ever need them; nothing in Tier 1
  or 2 does.
- `Infinity` is not valid JSON. Dijkstra's infinity is encoded as the string
  `"inf"`, and the Linear/Grid renderers special-case it to render the infinity
  glyph. This is ugly and it is the least-bad option; the alternatives (a magic
  number like 1e308, or an `{"$inf":true}` wrapper) are worse for `expr` display
  and for diffing.
- Records are for node payloads only. Do not put a 40-field struct in a cell;
  the format records `from` and `to`, so a large value costs double. See
  `ARCHITECTURE.md` §9.

---

## 6. Provenance - how explanations get generated

```jsonc
"expr": "max(dp[3][4], dp[4][3])",
"deps": [
  { "s": "dp", "at": [3,4], "v": 4 },
  { "s": "dp", "at": [4,3], "v": 7 }
]
```

`deps[].v` is **the value at the moment it was read**, snapshotted into the
event. It is not looked up during replay. Two reasons, both load-bearing:

1. **Rewind correctness.** During backward stepping, current state may not
   equal the state at the moment of the read for events later in the trace.
   Snapshotting makes the explanation exact regardless of playback direction.
2. **It makes the explanation self-contained.** The explain pane renders from
   the event only - no state lookups, no cross-referencing, trivially testable.

Cost: duplication. `deps[].v` is derivable by replaying to just before the
event, so it is redundant data. For a 200k-event trace with 2 deps each, that is
~400k extra numbers. Accepted, because correctness under rewind is worth more
than bytes at our scale, and the columnar encoder (Tier 2) compresses it well.

### 6.1 The explanation template

The explain pane runs one generic template. There is no per-algorithm code (I2).

```
<addr> <- <to>           when deps is empty and from is the fill value
<addr>: <from> -> <to>   otherwise
because <expr>
where  <s><at> was <v>,  <s><at> was <v>
```

Rendered for the example above:

```
dp[4][4]: 0 -> 7
because max(dp[3][4], dp[4][3])
where dp[3][4] was 4, dp[4][3] was 7
```

`note`, when present, replaces the `because` line. Algorithms use it for phase
narration that has no expression: `"partitioning around pivot 7"`.

For `call`: `lcs(i=3, j=4)`.
For `ret` with deps: `returns 7 - read from memo[3][4], already computed at step 12`
(the "step 12" comes from the pre-pass `firstWrite` index, not from the event).

**This is the entire "plain English" system.** ~60 lines of JS. It is
deliberately not clever. Clever narration is `BACKLOG.md`.

---

## 7. `meta.views` - render hints as data

```jsonc
"views": [
  { "family": "grid",           "s": "dp",     "pane": 0, "title": "DP table" },
  { "family": "recursionTree",  "s": "$calls", "pane": 1, "title": "Call tree",
    "options": { "memoOf": "dp" } },
  { "family": "callStack",      "s": "$calls", "pane": "side" }
]
```

- `family` names a renderer module. The frontend has a registry
  `family -> component`; an unknown family falls back to the text tree renderer
  rather than erroring.
- `s` names a structure, or the pseudo-structure `"$calls"` for anything derived
  from `call`/`ret`.
- `pane` is `0`, `1`, or `"side"`. Two panes maximum in Tier 1.
- `options` is family-specific and opaque to everything else.

**Why this does not violate I2.** The renderer is still a pure function of
`(state, step, viewSpec)`. It reads a declarative record; it does not import
algorithm code or branch on `meta.algo`. The alternative - infer the family from
`kind` - fails immediately on an adjacency matrix (`kind:"grid"`, wants the
graph renderer) and on a binary heap (`kind:"array"`, wants tree layout).
Inference would have to consult the algorithm name to fix those cases, which
*would* violate I2. Hints are the purer option, counterintuitively.

If `views` is absent the frontend falls back to `kind -> family` defaults. That
path must keep working; it is what user-authored Stage B traces get by default.

---

## 8. Caps and truncation

Three independent caps. They exist because they fail in different places.

| Cap | Default | Enforced by | Failure it prevents |
|---|---|---|---|
| events | 200,000 | producer (Go tracer / WASM guest) | runaway recursion, exponential DP |
| serialized bytes | 8 MiB | producer, after encode | huge values x many events -> slow parse |
| wall clock | 5 s (built-in) / 10 s (Stage B) | host: server ctx, or Worker watchdog | infinite loop that performs **no writes** - the event cap never fires |

The wall-clock cap is the non-obvious one and it is required: an empty infinite
loop emits zero events and would sit under the event cap forever.

**Truncation is a teaching moment, not an error.** On cap:

- recording stops; the trace so far is valid and playable
- `meta.truncated = true`, `meta.truncatedReason` set
- the UI shows a banner, not a modal:

```
  +-----------------------------------------------------------------+
  | * Stopped at 200,000 steps.                                     |
  |   fib(40) makes ~331 million calls. That is the point of this   |
  |   visualization - the recursion tree below is what exponential  |
  |   looks like. Try the memoized version ->                       |
  +-----------------------------------------------------------------+
```

The banner text is chosen by the frontend from `truncatedReason` plus whether
the trace contains a `map`/`grid` structure that is only read (i.e. no memo).
That heuristic lives in the UI, is one function, and is allowed to be wrong -
it is a hint, not a diagnosis.

**Input caps are separate and are not the same thing.** 10x10 is an *input*
bound. It does not bound trace size: N-Queens on a 10x10 board has a call tree
in the hundreds of thousands of nodes. The two are related by the algorithm's
complexity, i.e. not at all. Per-family *render* caps are in each
`RENDERERS/*.md`. This mismatch is called out in `FLAWS.md` §3.

---

## 9. Versioning

`v` is an integer. Current: **1**.

**Additive changes do not bump `v`.**
Adding an optional field, a new `kind`, a new `family` string, a new value shape
behind a new key - none of these bump. Consumers **must** ignore unknown keys and
**must** degrade gracefully on unknown enum values (unknown `kind` -> fallback
renderer; unknown `family` -> fallback renderer).

**Breaking changes bump `v`.**
Removing a field, retyping a field, changing the meaning of an existing value,
changing path semantics, adding a fifth event type (because old players would
mis-order steps around it).

Consumer contract:

```
if trace.v > SUPPORTED_MAX  -> refuse, show "this trace was made by a newer
                               version of Orrery" plus meta.engine
if trace.v < SUPPORTED_MIN  -> run it through migrations[v] in sequence
otherwise                   -> load
```

Migrations live in `internal/trace/migrate.go` and `web/src/lib/migrate.js`, as
a list of `(from, to, fn)`. Each migration ships with a golden trace at the old
version, so migrations are themselves regression-tested.

### Why an integer and not semver

The only question a consumer ever asks is "can I read this?" That is a total
order. Semver invites a compatibility matrix nobody maintains, and it invites
arguments about whether adding an optional field is a minor or a patch. An
integer plus a written additive-change policy answers the real question in one
comparison. `ADR/0019-versioning.md`.

---

## 10. Validator checks

`orrery verify` (Go) and `validate()` (JS) implement the same list. The JS one
runs on *every* trace load, including from the network - it is the trust
boundary. Cost is O(events), budgeted at under 10ms for 200k events.

| # | Check | Severity |
|---|---|---|
| V1 | `v` is an integer within supported range | error |
| V2 | every `set.s` refers to a structure with an earlier `init` | error |
| V3 | `at` is well-formed for the structure's `kind`; grid indices within `dims` | error |
| V4 | replaying forward, every `set.from` deep-equals current state at `at` | error |
| V5 | `call`/`ret` are balanced; no `ret` without an open `call` | error |
| V6 | after full forward then full backward replay, state == initial state | error |
| V7 | group ids form contiguous runs; a `g` value never reappears after a gap | error |
| V8 | `lvl > 0` only on structures with `aux: true` | error |
| V9 | `deps[].s/at` refer to structures that exist at that point | error |
| V10 | `ln` within `meta.source.text` bounds | warning |
| V11 | `from` deep-equals `to` (a no-op write) | warning |
| V12 | node id begins with `$` | error |
| V13 | `meta.views[].s` exists, or is `"$calls"` | warning |
| V14 | serialized size within byte cap | warning |

V4 and V6 are the two that matter. Together they are a complete proof that the
trace is a valid reversible delta log, and they are about 40 lines each.

---

## 11. Wire size

Order-of-magnitude figures, recorded here so nobody optimizes this before
measuring. Re-measure once real traces exist; these are estimates from the
event shapes above, not benchmarks.

| Trace | Events | Minified JSON | gzip |
|---|---|---|---|
| LCS 7x8 | ~143 | ~18 KB | ~3 KB |
| Bubble sort n=10 | ~180 | ~21 KB | ~3 KB |
| N-Queens 6x6 | ~9,300 | ~1 MB | ~100 KB |
| At the 200k cap | 200,000 | ~22 MB | ~2 MB |

Conclusions: gzip is mandatory and free (`chi/middleware.Compress`). A columnar
or CBOR encoding would cut minified size roughly 4x and is a real Tier 2 option,
but at Tier 1 scale (the top two rows - the ones a human actually watches) it
would save about 15 KB. **Do not build it until a real trace exceeds 2 MB
gzipped.** `FLAWS.md` §9 lists this among the premature optimizations to resist.

---

## 12. Worked examples

Every renderer family, one worked trace. These are abbreviated (`ln`, `g` and
`lvl` omitted where 0) but structurally exact. Fuller versions become the
golden fixtures in `testdata/golden/`.

### 12.1 Grid - LCS DP, one cell

```jsonc
{"t":"init","s":"dp","kind":"grid","dims":[7,8],"fill":0,
 "labels":{"rows":["","A","G","G","T","A","B"],"cols":["","G","X","T","X","A","Y","B"]}}
{"t":"set","s":"dp","at":[1,1],"from":0,"to":0,
 "expr":"max(dp[0][1], dp[1][0])","deps":[{"s":"dp","at":[0,1],"v":0},
                                          {"s":"dp","at":[1,0],"v":0}],"ln":31}
{"t":"set","s":"dp","at":[2,1],"from":0,"to":1,
 "expr":"1 + dp[1][0]","deps":[{"s":"dp","at":[1,0],"v":0}],"ln":28,
 "note":"a[1]=='G' matches b[0]=='G'"}
```

Explain pane for the last one:
`dp[2][1]: 0 -> 1 . a[1]=='G' matches b[0]=='G' . where dp[1][0] was 0`

### 12.2 Linear - bubble sort swap, grouped, with cursors

```jsonc
{"t":"init","s":"a","kind":"array","dims":[5],"fill":0}
{"t":"init","s":"i","kind":"scalar","aux":true}
{"t":"init","s":"j","kind":"scalar","aux":true}
{"t":"init","s":"sorted","kind":"scalar","aux":true}     // boundary of sorted suffix
...
{"t":"set","s":"j","at":[],"from":1,"to":2,"lvl":1,"expr":"j + 1"}
{"t":"set","s":"a","at":[2],"from":9,"to":3,"g":7,
 "expr":"a[3]","deps":[{"s":"a","at":[3],"v":3}],"note":"9 > 3, swap"}
{"t":"set","s":"a","at":[3],"from":3,"to":9,"g":7,
 "expr":"a[2]","deps":[{"s":"a","at":[2],"v":9}]}
```

Both `g:7` events advance together: **one step, two writes.** The `j` cursor is
`lvl:1`, so at detail level 0 the user sees only swaps; at level 1 they see the
scan pointer move. This is the entire granularity dial (§13).

### 12.3 Call stack - fib(4), unmemoized

```jsonc
{"t":"call","fn":"fib","args":[{"n":"n","v":4}],"ln":8}     // event 0 -> node id 0
{"t":"call","fn":"fib","args":[{"n":"n","v":3}],"ln":11}    // event 1 -> node 1, parent 0
{"t":"call","fn":"fib","args":[{"n":"n","v":2}],"ln":11}    // event 2 -> node 2, parent 1
{"t":"call","fn":"fib","args":[{"n":"n","v":1}],"ln":11}
{"t":"ret","v":1,"ln":9}
{"t":"call","fn":"fib","args":[{"n":"n","v":0}],"ln":11}
{"t":"ret","v":0,"ln":9}
{"t":"ret","v":1,"expr":"fib(1) + fib(0)","ln":11}
```

No `set` events at all - recursion with no tracked structure is still a
first-class trace. The call-stack and recursion-tree renderers consume
`"$calls"`.

### 12.4 Recursion tree - memoized fib, showing a memo hit

```jsonc
{"t":"init","s":"memo","kind":"map"}
{"t":"call","fn":"fib","args":[{"n":"n","v":5}]}            // node 1
...
{"t":"set","s":"memo","at":["3"],"from":null,"to":3,
 "expr":"fib(2) + fib(1)","deps":[...]}                     // event 14: memo[3] born
...
{"t":"call","fn":"fib","args":[{"n":"n","v":3}]}            // node 22
{"t":"ret","v":3,"expr":"memo[3]","deps":[{"s":"memo","at":["3"],"v":3}]}
```

Node 22 is a `call` whose immediately-following `ret` has deps into `memo`, and
whose subtree is empty. The renderer recognises that shape and draws it as a
**memo-hit leaf** with a dashed citation edge to the node that was on the stack
at event 14 (found via the pre-pass `firstWrite` index). No algorithm-specific
code anywhere. This is the flagship.

### 12.5 Linked list - Floyd cycle detection

```jsonc
{"t":"init","s":"L","kind":"nodes",
 "schema":{"fields":{"val":"scalar","next":"ptr"},
           "refs":["head","slow","fast"],"label":"val","order":["next"]}}
{"t":"set","s":"L","at":["n0"],"from":null,"to":{"val":3,"next":null}}
{"t":"set","s":"L","at":["n1"],"from":null,"to":{"val":2,"next":null}}
{"t":"set","s":"L","at":["n0","next"],"from":null,"to":{"$":"n1"}}
...
{"t":"set","s":"L","at":["n4","next"],"from":null,"to":{"$":"n1"}}   // the cycle
{"t":"set","s":"L","at":["$refs","head"],"from":null,"to":{"$":"n0"}}
{"t":"set","s":"L","at":["$refs","slow"],"from":null,"to":{"$":"n0"},"g":1}
{"t":"set","s":"L","at":["$refs","fast"],"from":null,"to":{"$":"n0"},"g":1}
{"t":"set","s":"L","at":["$refs","slow"],"from":{"$":"n0"},"to":{"$":"n1"},"g":2,
 "expr":"slow.next"}
{"t":"set","s":"L","at":["$refs","fast"],"from":{"$":"n0"},"to":{"$":"n2"},"g":2,
 "expr":"fast.next.next"}
```

The construction prologue (building the list) is itself a set of steps. The UI
collapses steps before a `meta.views[].startStep` marker by default, with a
"show construction" toggle. Watching the list get built is genuinely useful the
first time and tedious the tenth.

### 12.6 Tree - BST insert

```jsonc
{"t":"init","s":"T","kind":"nodes",
 "schema":{"fields":{"val":"scalar","left":"ptr","right":"ptr"},
           "refs":["root","cur"],"label":"val","order":["left","right"]}}
{"t":"set","s":"T","at":["n0"],"from":null,"to":{"val":8,"left":null,"right":null}}
{"t":"set","s":"T","at":["$refs","root"],"from":null,"to":{"$":"n0"}}
{"t":"set","s":"T","at":["$refs","cur"],"from":null,"to":{"$":"n0"},"lvl":1}
{"t":"set","s":"T","at":["n1"],"from":null,"to":{"val":3,"left":null,"right":null}}
{"t":"set","s":"T","at":["n0","left"],"from":null,"to":{"$":"n1"},
 "expr":"3 < 8, go left; left is empty","deps":[{"s":"T","at":["n0","val"],"v":8}]}
```

`order: ["left","right"]` guarantees the layout draws left children left, always,
even before the right child exists. Determinism comes from the schema, not from
insertion order. See `RENDERERS/TREE.md` §3.

### 12.7 Graph - Dijkstra edge relaxation

```jsonc
{"t":"init","s":"g","kind":"graph",
 "schema":{"nodes":["a","b","c","d"],"directed":false,"weighted":true,
           "edges":[["a","b",4],["a","c",2],["c","b",1],["b","d",5]],
           "refs":["u","v"],"layoutHint":"force"}}
{"t":"init","s":"dist","kind":"map","fill":"inf"}
{"t":"init","s":"done","kind":"map","fill":false}
{"t":"init","s":"pq","kind":"array","dims":[0],"aux":true}
{"t":"set","s":"dist","at":["a"],"from":"inf","to":0,"expr":"source"}
...
{"t":"set","s":"g","at":["$refs","u"],"from":null,"to":{"$":"a"},"expr":"pop min from pq"}
{"t":"set","s":"g","at":["$refs","v"],"from":null,"to":{"$":"c"},"lvl":1,
 "note":"examining edge a-c"}
{"t":"set","s":"dist","at":["c"],"from":"inf","to":2,
 "expr":"dist[a] + w(a,c) = 0 + 2","deps":[{"s":"dist","at":["a"],"v":0},
                                           {"s":"g","at":["$edges","a|c","w"],"v":2}]}
{"t":"set","s":"done","at":["a"],"from":false,"to":true}
```

A *failed* relaxation writes nothing to `dist`, so it is not a step at level 0.
At level 1 the `v` cursor still moves, so the user sees the edge get examined
and the explain pane says `examining edge a-b . 0 + 4 = 4, not < 4, skip` via a
`note`. This is exactly the cursor-structure pattern earning its keep.

### 12.8 Fallback - anything unrecognized

```jsonc
{"t":"init","s":"state","kind":"map"}
{"t":"set","s":"state","at":["config","retries"],"from":3,"to":2}
```

Nested map paths render as a collapsible text tree. Any structure whose family
is unknown lands here rather than erroring. This is what makes a
malformed-but-valid user trace still *do something*.

---

## 13. Detail levels - and the exact condition under which they are sound

`lvl` filters events. The player builds its step index over the subset of events
whose `lvl` is at most the selected level.

**This is unsound in general.** Skipping a write means the replayed state
diverges from the true state.

**It is sound under one restriction, which the format enforces (check V8):**

> `lvl > 0` is permitted only on `set` events targeting a structure declared
> `aux: true`, and an `aux` structure may never appear in any `deps`.

Proof sketch: aux structures are write-only from the algorithm's perspective -
nothing reads them, so no non-aux value depends on them. Removing all writes to
an aux structure therefore leaves the state of every non-aux structure
unchanged at every step boundary. The aux structure's own state becomes stale,
which is fine, because filtering it out also hides its view.

That is four lines of reasoning and it is the difference between "nice feature"
and "silently corrupts rewind." Write the check; do not trust discipline.
`ADR/0016-detail-levels.md`.

---

## 14. Reserved for future versions

Named here so nobody accidentally uses them for something else.

| Key | Reserved for |
|---|---|
| `e.ts` | wall-clock or logical timestamp (concurrency, v2) |
| `e.tid` | goroutine/thread id (concurrency, v2) |
| `meta.strings` | per-algorithm explanation templates |
| `meta.complexity` | declared big-O, for the empirical-complexity feature |
| `$self` | reserved path segment |
