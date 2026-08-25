# ADR 0020 — Grouped events for multi-write steps

**Status:** accepted

## Context

Some single conceptual actions perform more than one write. A swap is two. A
three-way partition move is three. `a[i], a[j] = a[j], a[i]` in Go is one
statement and two writes.

Showing a swap as two steps looks broken: the array passes through a state where
one element is duplicated and the other is gone. A viewer reads that as a bug in
the visualizer.

## Decision

Every event carries `g`, a group id. **Adjacent events sharing a non-zero `g`
form one step.** Zero means ungrouped.

The player builds `steps: []{e0, e1}` — an index of event ranges — once, in the
pre-pass. Forward applies the whole range; backward unapplies it **in reverse
order**.

```go
tr.Group(func() {
    a.Set(i, a.At(j))
    a.Set(j, tmp)
}).Note("swap a[%d] and a[%d]", i, j)
```

## Alternatives

**A `beginStep` / `endStep` event pair.** Rejected: two more event types, each
needing a defined inverse, for something an integer field expresses. Unbalanced
pairs would also be a new failure mode.

**A single `setMany` event carrying multiple writes.** Rejected: it makes the
event type non-uniform, complicates the address/provenance model (one `expr` for
several writes?), and every consumer would need a second code path. `g` keeps
every event a plain `set`.

**Let the consumer decide what to group** (e.g. "writes on the same line are one
step"). Rejected: two consumers would then disagree about step numbering, which
breaks deep links, the step counter, and the conformance suite. Step boundaries
must be a property of the trace.

**Do nothing; accept two-step swaps.** Rejected on the strength of how bad it
looks. This is a visualization product; a half-swap on screen is a correctness
bug as far as the user is concerned.

## Consequences

- The step index is ~15 lines in the pre-pass and the player's `next`/`prev`
  become loops over a range rather than single applies. Small, contained.
- Backward **must** unapply in reverse order within a group, or a swap rewinds
  into a duplicate. This is the one place ordering matters and it deserves a
  test of its own.
- Validator check **V7**: group ids form contiguous runs; a `g` value never
  reappears after a gap. Without it, a producer bug could silently merge two
  distant steps.
- `Group` returns an `*Ev` pointing at the **first** event of the group, so a
  `Note` attaches to the step as a whole.
- Nested groups **flatten** — the outermost wins. Deliberate: nested step
  granularity is a feature nobody asked for and it would make the index a tree.
- Stage B's rewriter must emit a group for Go's multi-assignment, and must
  preserve Go's evaluation order (all RHS operands first). `STAGE_B.md` §5.3.
