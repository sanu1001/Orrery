# ADR 0002 — Reversible delta log, not snapshots

**Status:** accepted

## Context

The product promises stepping **backward**. There are three ways to get it:
re-run from the start, store a snapshot per step, or store invertible deltas.

## Decision

Every `set` event records both `from` and `to`. Forward applies `to`; backward
applies `from`. The player holds one mutable state and moves through it.

**Invariant I1: every event must be undoable from itself alone.** No event may
require scanning other events to be reversed.

## Alternatives

**Re-run the algorithm from step 0 on each backward press.** Rejected: forces
every algorithm to be re-entrant and deterministic, and makes backward O(k) with
a large constant. Also produces no provenance.

**Snapshot the state at each step.** Rejected as the primary mechanism:
O(steps x state) memory, and — the real objection — diffing two snapshots tells
you *what* changed but never *why*. Provenance is the product.

Worth conceding: for a 10x10 grid over 100 steps, snapshots would be entirely
adequate. The delta log earns its keep at recursion-tree scale and for the
explanation feature, not on the grid. Say that when challenged; it is more
persuasive than a blanket claim.

**Deltas without `from` (forward-only), rewinding by replay from 0.** Rejected:
halves event size and makes seek O(target) instead of O(distance), and makes
`prev()` the untested path — which is the direction that actually breaks.

## Consequences

- Seek is **O(distance)**, not O(target). Scrubbing applies events incrementally
  in whichever direction the drag moves.
- Two validator checks (V4, V6) constitute a complete proof that a trace is a
  valid reversible log, in about 80 lines.
- Cost: events roughly double in size versus forward-only, and the tracer must
  read before every write. Both accepted.
- Cold seek to step 150k replays from 0 (~30ms). Checkpoints are designed but
  **not built**; trigger is a measured cold seek above 100ms.
