# ADR 0016 — Detail levels as a filter, sound only over aux structures

**Status:** accepted

## Context

Different viewers want different granularity. Someone learning binary search
wants to see `lo`, `mid` and `hi` move. Someone reviewing it wants only the
result. Producing two traces per algorithm is wasteful and would make them drift.

## Decision

Events carry `lvl`. The player builds its step index over the subset of events
with `lvl <= selectedLevel`. One trace, a granularity dial.

**Filtering events is unsound in general** — skipping a write makes replayed
state diverge from true state. It is sound under exactly one restriction, which
the format enforces as validator check **V8**:

> `lvl > 0` is permitted only on `set` events targeting a structure declared
> `aux: true`, and an `aux` structure may never appear in any `deps`.

**Proof sketch (revised during implementation -- see
`IMPLEMENTATION_NOTES.md` §5).** The first version of this argument was
"aux structures are never read, so nothing depends on them", and the validator
enforced it as an error. That rejected `mid = (lo + hi) / 2` in binary search --
an algorithm this design specifically exists to support.

The real argument is sharper and does not need the no-read rule at all:
**every `set` carries its full `to` value, never a delta.** Dropping an event
therefore cannot change the value any other event writes. The only casualty of
filtering is the filtered structure's own state going stale -- which is harmless
precisely because `aux` is what makes it hidden. Aux-reads-aux is fine, because
the whole cluster is filtered together.

What survives as an ERROR is `lvl > 0` on a non-aux structure, since that is
what guarantees the stale structure is the hidden one. Citing an aux structure
from a level-0 explanation is now a WARNING: the explanation would name
something not on screen.

## Alternatives

**Two traces per algorithm (coarse and fine).** Rejected: double generation,
double cache, and they drift.

**Filter at render time, not at step-index time.** Rejected: the events still
advance the step counter, so the user presses `next` and nothing visible
happens. Step counts must match what the user sees.

**Let any event carry `lvl`, and trust authors not to filter load-bearing
writes.** Rejected outright. This is the whole ADR: **do not trust discipline
where a four-line check will do.** An unsound filter corrupts rewind silently,
which is the worst failure mode available.

**Collapse detail by grouping instead.** Rejected: grouping (ADR 0020) merges
adjacent events into one step, which is a different operation — it cannot *hide*
a cursor, only bundle it.

## Consequences

- `aux: true` becomes load-bearing metadata, not documentation.
- Changing level rebuilds the step index (O(events)) and re-seeks to the nearest
  surviving step. Fast enough to be instant; it is one pass.
- Cursor structures (ADR 0003) are almost always aux, so the two decisions
  compose: cursors make reads visible, levels make them optional.
- Tier 1 ships levels 0 and 1 only. The mechanism supports more.
