# ADR 0005 — Provenance as (expr, deps); explanations from a template

**Status:** accepted

## Context

The product promises a plain-English explanation of every step. The obvious
2026 answer is to ask a language model. That answer is wrong here for four
independent reasons, and the alternative is better in every dimension that
matters.

## Decision

Every write carries `expr` (a display string) and `deps` (the addresses read,
each with **the value it had at read time**). A single generic template turns
those into English:

```
dp[4][4]: 0 -> 7
because max(dp[3][4], dp[4][3])
where dp[3][4] was 4, dp[4][3] was 7
```

About 60 lines of JavaScript. No model, no network, no key.

## Alternatives

**An LLM generating narration per step.** Rejected:
1. **Correctness.** A model can be confidently wrong about arithmetic it did not
   perform. A visualizer that lies about why a cell is 7 is worse than one that
   says nothing.
2. **Latency and cost.** Stepping must be instant. Per-step inference is
   hundreds of milliseconds and a per-view cost.
3. **Determinism.** A share link must show the same words to everyone, forever.
4. **It answers the wrong question.** The interesting engineering is *capturing*
   causality at the source. Deferring it to a model is admitting you did not.

**Per-algorithm hand-written narration.** Rejected: violates I2 (renderers would
branch on algorithm), and it is N x steps of prose to maintain.

**Deriving `expr` from `deps` and an operator template.** Genuinely tempting —
it would remove a redundant field. Deferred: the string is what a human reads,
and generating `"max(dp[3][4], dp[4][3])"` from structure requires an operator
vocabulary that would grow forever. Keep the string; note that `deps` already
carries the structure if a richer rendering is ever wanted.

## Consequences

- Explanations are exact, instant, free, deterministic, and offline.
- `deps[].v` is **snapshotted at read time**, not looked up during replay. This
  is what makes explanations correct while rewinding, and it costs duplication
  (~2x on deps bytes). Accepted.
- Nothing verifies that `deps` is truthful — an algorithm can claim to have read
  cells it never touched. Low risk for built-ins (self-inflicted typo), higher
  for Stage B (a rewriter bug). `FLAWS.md` §2.
- `note` exists for phase narration that has no expression
  ("partitioning around pivot 7").
- The template is the only place text is generated, which contains the cost of
  i18n to one file if it is ever wanted.
