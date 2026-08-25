# ADR 0008 — Algorithms in Go, not JavaScript

**Status:** accepted

## Context

The frontend is JavaScript. Writing the built-in algorithms in JavaScript
would eliminate a service, a serialization boundary, and a deployment.

## Decision

Algorithms are written in Go, in `internal/algos`, and produce traces
server-side or at build time.

## Alternatives

**Algorithms in JavaScript, running in the browser.** Rejected on four counts:

1. **Stage B and C produce Go and C++ traces.** If built-ins were JavaScript,
   there would be two producer implementations of the format from day one, and
   the "one format, many producers" claim would be aspirational rather than
   demonstrated.
2. **The conformance suite needs two independent players in two languages.**
   Go-side algorithms make the Go replayer a natural artifact rather than a
   contrivance.
3. **The `orrery` CLI and terminal player** — the strongest evidence that
   renderers are decoupled — require the format to exist outside the browser.
4. **The audience.** This is a portfolio for backend/systems roles. A Go engine
   with a typed format, a validator, a fuzz target and a CLI is the artifact
   that audience reads. A JS file of sorting functions is not.

**Algorithms in Go compiled to WASM and run in the browser.** Rejected for
Tier 1: it is Stage B's machinery applied to code we control, and it adds a
600KB download for traces that can be generated at build time. Reconsider only
if arbitrary inputs must work with no server (they currently degrade to the
precomputed defaults, which is acceptable).

## Consequences

- A serialization boundary that a monolithic design would not have. Accepted —
  it is the boundary the project is about.
- Adding an algorithm is one Go file plus `//go:embed`, with **zero frontend
  changes**. Worth protecting; it is what makes adding an algorithm cheap.
- `runtime.Caller` gives free source-line capture, so the code pane works with
  no annotation burden.
- Build-time trace generation (`make traces`) means the demo works with the
  server off — which is the single best defence against a failed live demo.
