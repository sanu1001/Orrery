# ADR 0009 — React without TypeScript

**Status:** accepted, with a known cost (`FLAWS.md` §8)

## Context

The frontend consumes a format with a discriminated union of four event types, a
heterogeneous path type, and a value type with six shapes. That is close to the
ideal TypeScript use case. The stated constraint is no TypeScript and no
npm-heavy tooling.

## Decision

Plain JavaScript. Type safety is recovered by three mechanisms, in order of
how much they actually buy:

1. **A runtime validator at the single trust boundary.** Every trace is
   validated on load, implementing V1-V14. Past that line the shape is
   known-good, so the remaining risk is renderers misreading valid data — a much
   smaller surface than "anything could be anything."
2. **JSDoc typedefs on every module boundary**, with `// @ts-check` and a
   `jsconfig.json` setting `checkJs`. Editor-level checking, zero build step,
   zero `.ts` files.
3. **The producer is statically typed.** Go catches most shape bugs before a
   trace ever reaches the browser.

## Alternatives

**TypeScript.** Rejected against the stated constraint. Worth stating the honest
tradeoff rather than pretending JS is better: TS would catch a real class of
bug and would make refactoring the format materially safer. What it costs here
is a compile step, `.d.ts` friction, and — the real reason — learning TS *and*
React simultaneously while shipping, which `RISKS.md` R1 identifies as the
highest-likelihood failure mode.

**JSDoc alone, no runtime validator.** Rejected: JSDoc checks the code, not the
data. Traces arrive from the network and from user files; something must check
them at runtime regardless of what the source language is.

**Runtime schema library (zod / valibot).** Rejected: the validator has to
implement V4 and V6 (replay-based checks) which no schema library expresses, so
a library would cover only the easy half while adding a dependency.

## Consequences

- The dependency list stays at four packages.
- ~80 lines of hand-written validator, mirrored in Go, which the conformance
  suite keeps in sync.
- **Refactoring the format later is riskier than it would be with TS.** That is
  the real cost, and it is the honest answer when asked.
- The defensible framing: *"I get most of the checking from JSDoc plus a runtime
  validator at the one boundary where data actually enters, and the producer is
  statically typed."*
