# Architecture Decision Records

One file per decision that had a real alternative. Two more exist in the
private working set (the project name, and the workshop/repo split). Format is deliberately
short: **Context → Decision → Alternatives (and why each lost) → Consequences.**

If a decision had no plausible alternative, it does not get an ADR. If you
cannot name what lost, you have not made a decision — you have made an
assumption, and it belongs in `FLAWS.md` until you can.

| # | Decision | Status |
|---|---|---|
| 0001 | The trace is the interface | accepted |
| 0002 | Reversible delta log, not snapshots | accepted |
| 0003 | One step = one write; cursor structures for visible reads | accepted, with a known flaw |
| 0004 | Widen `set` to paths instead of adding node/edge events | accepted |
| 0005 | Provenance as (expr, deps); template-generated explanations | accepted |
| 0006 | Static skeleton layout | accepted |
| 0007 | Determinism and seeds; share the recipe | accepted |
| 0008 | Algorithms in Go, not JavaScript | accepted |
| 0009 | React without TypeScript | accepted, with a known cost |
| 0010 | Mutable player store + useSyncExternalStore | accepted |
| 0011 | HTML for tables, SVG for edges, canvas never (yet) | accepted |
| 0012 | View hints in the trace | accepted, with a known residue |
| 0013 | Compile on the server, execute in the browser | accepted |
| 0014 | Two independent caps: events and wall clock | accepted |
| 0015 | Postgres + pgx + sqlc + chi | accepted |
| 0016 | Detail levels as a filter, sound only over aux structures | accepted |
| 0019 | Integer version + additive-change policy | accepted |
| 0020 | Grouped events for multi-write steps | accepted |
