# ADR 0011 — HTML for tables, SVG for edges, canvas never (yet)

**Status:** accepted

## Context

Eight renderer families need a drawing technology. The reflexive choice for a
visualizer is "SVG everywhere" for consistency, or "canvas" for performance.

## Decision

**HTML where the structure is tabular or linear. SVG where there are edges.
Canvas only after measuring a real problem.**

| Family | Tech |
|---|---|
| Grid | HTML `<table>` |
| Linear, Call stack, Fallback | HTML |
| Recursion tree, Tree, Linked list, Graph | SVG |
| anything | canvas — not in Tier 1 or 2 |

## Alternatives

**SVG for everything, for implementation consistency.** Rejected. It costs, on
the two renderers users look at longest: text rendering quality, `tabular-nums`,
text selection, `:hover` without hit-testing, and table semantics for screen
readers. Consistency of implementation is worth less than quality of output.

**Canvas for everything.** Rejected: no accessibility, no text selection,
manual hit-testing, manual layout, and it solves a performance problem that does
not exist at 100 cells or 1,500 nodes.

**A canvas fallback above a node threshold, per family.** Rejected for Tier 1:
two code paths per family is double the work and double the bugs, to fix a
problem no measurement has found. The one exception granted is the **recursion
tree minimap**, which is a static bitmap drawn once — that is not a second
render path, it is an image.

## Consequences

- Grid gets `<th>` semantics, selectable text and spreadsheet copy-paste free.
- Scale beyond SVG's comfort is handled by **culling**, not by switching
  technology — and culling is safe because layout is static (ADR 0006).
- **Numeric trigger to revisit:** a single pane painting more than 8ms on a
  mid-range laptop. Until that is measured, canvas is `FLAWS.md` §9 territory.
- Cost: two mental models in `render/`. Mitigated by the shared `CursorChip`
  component and the shared props contract, which are what actually make the
  families feel unified.
