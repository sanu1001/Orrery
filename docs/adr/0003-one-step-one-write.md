# ADR 0003 — One step = one write; cursor structures for visible reads

**Status:** accepted, with a known flaw (`FLAWS.md` §1)

## Context

Granularity is a product decision, not a technical one. A 5x5 DP performs 25
writes and roughly 400 reads and comparisons. Stepping through 400 events is
not watching an algorithm; it is scrolling.

## Decision

A **step** is one write to a tracked structure. Reads and comparisons are not
steps; they attach to the write they caused, as `deps`.

To make a read *visible*, promote it to a write on an auxiliary structure — a
**cursor structure**. `mid` in a binary search becomes a real `scalar`, and
moving it becomes a real step with real provenance.

## Alternatives

**Every read and comparison is a step.** Rejected: 400 steps for a 5x5 DP. The
design target is a human watching 10-20 steps.

**A `read` event type that the player skips but renderers can show.** Rejected:
it adds a fifth event type that has no inverse to define (reads do not change
state), and it makes "what is a step" a property of the consumer rather than the
trace — so two consumers would disagree about step numbering, breaking deep
links and the conformance suite.

**Let the algorithm mark arbitrary events as step boundaries.** Rejected as
*additional* machinery; grouping (ADR 0020) already covers the real case, and
cursor structures cover the rest with existing events.

## Consequences

- A 5x5 DP is 25 steps. Correct.
- Comparison-driven algorithms (binary search, most sorts) produce almost no
  steps **unless the author adds cursors**. Nothing detects a missing cursor.
  This is the largest known flaw in the design and it is documented as such.
- Cursor structures turn out to be a general and elegant mechanism: two-pointer
  indices, sliding-window bounds, the Dijkstra edge cursor, and the quicksort
  pivot are all the same thing.
- Combined with detail levels (ADR 0016), cursors give a granularity dial over a
  single trace rather than requiring two traces.
- Irony worth noting: the Stage B rewriter discovers cursors automatically, so
  **pasted user code gets better instrumentation than hand-written built-ins**.
