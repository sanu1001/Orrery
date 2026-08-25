# ADR 0006 — Static skeleton layout

**Status:** accepted

## Context

A tree or graph that grows as you step will reflow on every step if layout is
computed from the currently visible nodes. Existing nodes move because new
siblings appeared. The result is unwatchable, and it is the defect that makes
most recursion-tree visualizers useless.

## Decision

Because a trace is complete before the first frame is drawn, **layout is a batch
problem, not an online one.**

```
layout  = f(union, options)     computed ONCE at load, memoized
visible = g(state, step)        computed per step, cheap
render  = draw(visible ∩ layout)
```

`union` is the pre-pass record of every address, node and edge that will *ever*
exist. A node appearing at step 40 is already positioned at step 0; it is simply
not drawn. **Nothing ever moves.** Enter and exit are opacity and scale only.

## Alternatives

**Incremental layout with position interpolation (springs).** Rejected: needs
per-node state, is expensive, and *still moves things* — it makes the movement
prettier, not absent.

**Fixed grid by (depth, sibling index).** Rejected: never jumps, but is
unreadably wide for unbalanced trees, which is the common case.

**Damped relayout with a movement threshold.** Rejected: tuning a threshold is
an endless argument, and it fails exactly when the tree grows fastest.

**Streaming traces.** Would make this impossible, which is one of the strongest
arguments against streaming (ADR 0001).

## Consequences

- Trees, graphs and recursion trees are all rigid pictures that fill in.
- Force-directed graph layout can be run offline to convergence and frozen, so a
  seeded layout is pixel-identical on every load — which is what makes share
  links honest (ADR 0007).
- **Culling for scale becomes safe**: a culled node reappears in exactly its old
  position, so focus mode causes no movement.
- Cost: early steps look sparse, and the camera must fit content that is mostly
  absent. Resolved per family — fit-to-union for small structures, damped
  fit-to-visible for the recursion tree. That is a camera pan of a rigid picture,
  not a relayout.
- Cost: the pre-pass is O(events) on the critical path, and it is the memory
  high-water mark. `FLAWS.md` §10.
