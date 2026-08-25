# ADR 0007 — Determinism and seeds; share the recipe, not the trace

**Status:** accepted

## Context

A share link must reproduce exactly what the sharer saw. Traces are up to
megabytes. Random inputs are, by definition, not reproducible.

## Decision

Every source of randomness is seeded and the seed is recorded in `meta.seed`:
random inputs, and force-directed graph layout.

A trace is therefore a pure function of `(algo, input, seed, engineVersion)`.
So a **share link stores the recipe** — about 120 bytes — and the trace is
regenerated or served from a content-addressed cache.

```
key = sha256(algo || canonicalJSON(input) || seed || engineVersion)
```

## Alternatives

**Store the trace bytes per share.** Rejected for built-ins: it stores a cache
entry inside a permalink, and a megabyte per share. *Accepted* for Stage B,
where the alternative would mean distributing a stranger's compiled binary to
other users (ADR 0013). Breaking your own rule deliberately, with a stated
reason, is fine.

**Encode the recipe in the URL fragment, no server at all.** Genuinely
attractive and it is what the app does for the *default* inputs (static-first).
Rejected as the only mechanism: long inputs make ugly URLs, and there is no hit
counting or abuse handling.

**Unseeded randomness with "regenerate" semantics.** Rejected: a link that shows
something different to each viewer is not a share link.

## Consequences

- Shares are tiny and the trace cache is a pure cache — it can be dropped
  entirely with no data loss.
- Content-addressed trace URLs can be served `immutable` with a one-year
  max-age, so a popular link is a CDN hit.
- **Known drift:** an engine change can alter what a share id resolves to.
  Mitigation: store `engine` on the share row and show *"recorded with v0.3.1,
  playing on v0.4.0"* when they differ. ~10 lines. Pinning old engine versions
  was considered and rejected as disproportionate.
- Determinism also makes golden traces stable, which makes them useful as a
  format regression suite.
