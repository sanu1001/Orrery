# ADR 0019 — Integer version + additive-change policy

**Status:** accepted

## Context

The trace format will change. Shared links, downloaded `.orrery.json` files and
committed golden fixtures all outlive any given engine build. Consumers exist in
two languages and will be updated at different times.

## Decision

`trace.v` is an **integer**. Current value: 1.

**Additive changes do not bump it.** New optional field, new `kind`, new
`family`, new value shape behind a new key — none bump. Consumers **must** ignore
unknown keys and **must** degrade gracefully on unknown enum values (unknown
`kind` or `family` falls back to the text renderer).

**Breaking changes bump it.** Removing a field, retyping a field, changing the
meaning of a value, changing path semantics, or adding a fifth event type
(because an old player would mis-order steps around it).

Consumer contract:

```
v > SUPPORTED_MAX -> refuse, show meta.engine and ask the user to refresh
v < SUPPORTED_MIN -> run migrations[v] in sequence
otherwise         -> load
```

## Alternatives

**Semantic versioning (`"1.2.0"`).** Rejected: the only question a consumer ever
asks is "can I read this?", which is a total order. Semver invites a
compatibility matrix nobody maintains and arguments about whether an optional
field is a minor or a patch. An integer plus a written policy answers the real
question in one comparison.

**No version field; sniff the shape.** Rejected: shape-sniffing fails silently
and gets worse with every change.

**A content-negotiated media type per version.** Rejected: correct for an HTTP
API, useless for a file on disk that someone drags into the browser.

**Never break the format.** Rejected as a plan rather than an aspiration —
`FLAWS.md` §5 already documents one field (`ln`) that was missing from the
original locked spec. There will be others.

## Consequences

- Most changes cost nothing, because most changes are additive.
- Migrations live in `internal/trace/migrate.go` and `web/src/lib/migrate.js` as
  an ordered list of `(from, to, fn)`. **Each migration ships with a golden
  trace at the old version**, so migrations are themselves regression-tested.
- The additive policy has a real requirement attached: consumers must actually
  ignore unknown fields. Go's `encoding/json` does by default; the JS validator
  must be written to allow-extra rather than reject-extra. Easy to get wrong,
  so it is an explicit test.
- Golden fixtures are committed pretty-printed with stable key order, so a
  format change shows up as a **readable diff across every fixture** — the best
  early-warning system the project has.
