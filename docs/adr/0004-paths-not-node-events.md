# ADR 0004 — Widen `set` to paths instead of adding node/edge events

**Status:** accepted

## Context

The locked spec addressed cells by integer index: `set(name, index, from, to)`.
Node-based structures — linked lists, trees, graphs, recursion trees — have
**identity**, not indices. A node is created, fields are written, pointers are
rewired. This was the largest open question in the design.

## Decision

Widen the address from `index []int` to a **path**: a sequence of segments where
an integer indexes and a string keys or selects a field.

```
set list ["n3"]              from null           to {val:9, next:null}   # create
set list ["n3","next"]       from null           to {"$":"n5"}           # link
set list ["$refs","slow"]    from {"$":"n1"}     to {"$":"n2"}           # move a pointer
set g    ["$edges","a|b","w"] from 7             to 5                    # relax an edge
```

**No new event types.** Topology is *derived from state* by walking the `ptr`
fields declared in the structure's schema, never asserted by events.

## Alternatives

**A parallel event family: `node`, `edge`, `link`, `unlink`.** Rejected on four
grounds:

1. Four event types each need a proven inverse; eight need eight. `link`/`unlink`
   pairs are exactly what goes subtly wrong when rewinding through a rotation.
2. A path already expresses everything they express. `link(a,"next",b)` *is* a
   `set` — and to be invertible it would have to carry the old pointer anyway,
   at which point it is a `set` with a worse name.
3. If events assert topology, events and state can disagree after a rewind.
   Deriving topology from state gives one source of truth, and rewind
   correctness is inherited from `set`.
4. `[3,4]` was already a valid path, so grid and array events serialize
   **identically** to before. Backward compatible by construction.

**A separate `nodes` sub-format with its own player.** Rejected: two players,
two sets of invariants, two conformance suites.

**Node ids as integers.** Rejected: strings let the LeetCode parser use
`n<tokenIndex>`, which keeps ids traceable back to the input, and JSON object
keys are strings anyway.

## Consequences

- Four event types, permanently. Adding a fifth now requires an ADR.
- Two reserved path namespaces, `$refs` and `$edges`; node ids may not start
  with `$` (validator check V12).
- Animation becomes a pure function of the delta's shape — see the dispatch
  table in `TRACE_FORMAT.md` §4.2. No event says "this is a creation"; the
  renderer derives it from `from === null`.
- Cost: complexity moves from the event *set* into the *schema*. That is the
  right place — the schema is data, versionable, and renderer-facing.
