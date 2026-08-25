# ADR 0022 — Breakpoints match by scanning events, never by replaying state

**Status:** accepted

## Context

`ROADMAP.md` C1 asks for time-travel breakpoints: "stop when `dp[5][5]`
changes", "stop when `x > 10`". A real debugger answers that by running the
program forward and testing a predicate against live state after each step,
because a running program is the only place its state exists.

Orrery is not in that position. The trace is complete before the first frame is
drawn.

## Decision

A breakpoint is `{s, at, op, value}` — an address and a comparison — and
matching it is a **linear scan over `trace.events`**. No state is reconstructed,
in either direction.

This works because of I1. Every `set` carries its full `to` value rather than a
delta, so the value an address holds after any write is sitting in the event
that wrote it. "The first step at which `dp[5][5] > 3`" is exactly "the first
`set` on that address whose `to` exceeds 3", and that is a filter over an array.

Two ops exist for the no-value case:

- `writes` fires on any write to the address.
- `changes` fires only when `from` and `to` differ.

Watch history is the same scan with the filter widened to every write, and it is
run **lazily per watch** rather than indexed in the pre-pass.

## Alternatives

**Replay and evaluate, like a real debugger.** Rejected. It is strictly more
expensive and it buys nothing here: to test a predicate at step k you must apply
k steps, so scanning backward means replaying from 0 every time. The scan is
O(events) in both directions and needs no player at all. This is the whole
reason the feature costs sixty lines.

**Only offer `changes`.** Rejected after it shipped and was wrong. A DP table
carries values forward: `dp[1][1] = max(dp[0][1], dp[1][0])` with both
neighbours 0 writes a 0 over a 0. That is a real computation the algorithm
performed, so a breakpoint on that cell that never fires reads as the feature
being broken rather than as a precise answer. `writes` is the default the
keyboard shortcut sets.

**A general expression language** (`dp[i][j] > dp[i-1][j] + 1`). Rejected as the
point where this turns from an afternoon into a fortnight: a parser, a scope for
`i` and `j`, and evaluation against state — which would drag replay back in
through the front door. An address plus a comparison covers both examples the
roadmap names and is honest about its limits.

**Index every write per address in the pre-pass.** Rejected: it costs memory
proportional to the whole trace for a feature most sessions never use, and
`prepass.js` is deliberately kept off the interaction path. A watch is created
by a human pressing a key; one linear scan at that moment is invisible.

## Consequences

- Backward search is a first-class operation rather than a hard one. "When did
  this cell *last* change before here" is the same code path as forward, which
  is what makes the feature genuinely *time-travel* rather than a stop button.
- Reverse-continue deliberately excludes the step already on screen. A test
  comparing "every match walking forward from 0" against "every match walking
  back from the end" is therefore wrong at the endpoint — the code is right and
  the test was not.
- A match inside a grouped step reports that step once (ADR 0020). Stopping
  twice on one step has no meaning.
- Nothing was added to the format. Breakpoints and watches are entirely
  consumer-side, which is what lets a downloaded trace be debugged by a
  consumer the producer has never heard of.
