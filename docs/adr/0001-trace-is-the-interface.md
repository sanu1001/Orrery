# ADR 0001 — The trace is the interface

**Status:** accepted

## Context

An algorithm visualizer must connect N algorithms to M views. The default
approach — algorithms calling `drawSwap(i, j)` — makes that connection N x M and
makes rewind impossible, because a draw call has no inverse.

## Decision

Algorithms emit a **trace**: a flat, ordered list of events, serializable as
JSON. Renderers consume traces and nothing else. Neither knows the other exists.

The trace is a **format**, not a function call. It can be written to a file,
diffed, committed as a fixture, validated by a separate binary, version
negotiated, and produced by three different languages.

## Alternatives

**Direct render callbacks.** Rejected: N x M coupling; no inverse for rewind;
every new algorithm needs renderer changes.

**Full state snapshot per step.** Rejected as the *interface* (it survives as a
possible internal optimization, ADR 0002). A snapshot says what the state is,
never what was read to produce it — so the explanation feature is impossible.

**An observer/event-emitter API in-process.** Rejected: it is the callback
design with indirection. Because it is not serializable it cannot be tested with
fixtures, cannot be produced by WASM, and cannot be shared.

**Streaming over a WebSocket.** Rejected: our algorithms finish in microseconds,
so streaming buys nothing, and it forfeits the whole-future property that makes
layout stable (ADR 0006).

## Consequences

- N + M work instead of N x M.
- A second consumer (`orrery play`, the terminal player) becomes almost free,
  and its existence is the proof that the decoupling is real.
- The format becomes the thing that must be designed carefully, versioned, and
  tested — which is the intended centre of gravity for a systems portfolio.
- Cost: an indirection layer between the algorithm and the picture, and a
  serialization step that would be unnecessary in a monolithic design.
