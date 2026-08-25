# ADR 0012 — View hints in the trace

**Status:** accepted, with a known residue (`FLAWS.md` §6)

## Context

Invariant I2 says renderers never import from algorithms. But **something** must
decide that `dp` is drawn as a grid and `$calls` as a recursion tree.

## Decision

The trace carries `meta.views`: a declarative list of
`{family, s, pane, title, options}`. The renderer reads a record. It does not
import algorithm code and does not branch on `meta.algo`.

When `views` is absent, a `kind -> family` fallback table applies
(`RENDERERS/00-OVERVIEW.md` §4).

## Alternatives

**Infer the family from `kind` alone.** Rejected — it fails on real cases:

- an adjacency matrix is `kind: grid` and wants the graph renderer
- a binary heap is `kind: array` and wants a tree view
- a map keyed `"3,4"` is a grid in disguise
- `$calls` is both a call stack and a recursion tree, and which you want depends
  on depth and on whether a memo table exists

Any inference good enough to fix those would have to consult `meta.algo`, which
is the violation I2 exists to prevent. **Hints are the purer option,
counterintuitively.**

**A frontend-side registry keyed by algorithm id.** Rejected: that is
`if (algo === 'dijkstra')` in a lookup table. Same coupling, hidden.

**Let the user choose the renderer in the UI, always.** Kept as a *secondary*
mechanism — the pane has a family switcher — but rejected as the default,
because a first-time viewer should not have to configure a visualization to see
it.

## Consequences

- Renderers stay pure functions of `(state, step, viewSpec)`.
- Adding an algorithm with an unusual presentation needs no frontend change.
- `options` is family-specific and opaque to everything else, which is what lets
  Linear support stacks, queues, deques and sliding windows without new
  families.
- **Residue, stated honestly:** the format now carries presentation intent, so
  it is not purely "what happened." Anyone calling that a smell is not wrong.
  The defence is that the alternative is worse, and that hints are *advisory* —
  the fallback path must keep working, and it is what Stage B traces use.
- Unknown `family` values must degrade to the fallback renderer, never error.
