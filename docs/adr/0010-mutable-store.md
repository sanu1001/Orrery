# ADR 0010 — Mutable player store + useSyncExternalStore

**Status:** accepted

## Context

Seeking is O(distance). Dragging a scrubber across a 9,000-step N-Queens trace
fires ~9,000 event applications inside one gesture. React's default idiom is
immutable state and `setState`.

## Decision

The player is a **plain JavaScript class holding mutable state**, with an
integer `version` bumped on every mutation. React observes it through
`useSyncExternalStore`, whose snapshot is that integer. Components read the
mutable state directly during render.

```js
// applyForward, in full
struct.cells[idx] = ev.to;
this._version++;
```

## Alternatives

**Immutable state + `setState`.** Rejected with numbers: each apply copies the
containing structure. A 10x10 grid is 100 cells, so a 9,000-step drag is
900,000 cell copies and 9,000 short-lived objects. The scrubber stutters, and
the usual fix — throttling the scrubber — makes seeking feel laggy, which is the
exact property the architecture promised would be instant.

**Redux / Zustand / Jotai.** Rejected: all assume immutable snapshots and an
action log. **We already have an action log — it is called the trace, it is on
disk, and it rewinds.** A state library would be a second, worse copy of the
thing this project is about.

**Immer.** Rejected: structural sharing still allocates per apply, and it adds a
dependency to solve a problem created by choosing immutability in the first
place.

**Keep the player outside React entirely and re-render on a timer.** Rejected:
tears and dropped updates; `useSyncExternalStore` is the supported primitive for
exactly this and it is ten lines.

## Consequences

- `next()` / `prev()` are allocation-free. Scrubbing 200k events is
  microseconds of state work.
- `changed()` returns a `Set` of address keys, which drives CSS-only flashing —
  no per-frame React state, no animation loop for flashes.
- **Sharpest edge in the codebase:** mutable state tears if mutated during
  render. `useSyncExternalStore` prevents tearing **only if all mutations happen
  outside render, synchronously, followed by a version bump.** That invariant is
  stated at the top of `store.js`. Violating it produces subtle visual glitches
  rather than loud errors.
- Cell components need `React.memo` with an explicit comparator, or the
  version bump re-renders everything and the win evaporates.
