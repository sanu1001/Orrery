# ADR 0023 — Linked lists get their own layout, not the tidy-tree one

**Status:** accepted

## Context

A linked list is a tree with a branching factor of one. The tidy-tree layout
(`layout/tidyTree.js`, Reingold–Tilford via Buchheim et al.) already exists, is
tested, and handles that input without complaint.

So the cheap move is obvious, and it was written down as fact in two places
before anyone checked it: `CLAUDE.md` claimed "tree and linked-list reuse
`layout/tidyTree.js` completely unchanged", and the day-one notes budgeted the
pair at twenty hours on that basis.

## Decision

Lists get `layout/serpentine.js`: a left-to-right placement whose rows alternate
direction, about 150 lines.

What IS reused is the layer below. `layout/treeShape.js` derives topology by
reading pointer fields out of state, and "an edge is a `ptr` holding a ref" is
the same statement whatever shape the edges make. Trees and lists share that
unchanged and disagree only about arrangement.

Node order comes from the **union in creation order**, so every box has its slot
before the first frame. `options.reflow: "final"` switches to walking the
finished chain, for an algorithm that genuinely reorders nodes.

## Alternatives

**Reuse tidy-tree, as originally assumed.** Rejected on looking at the output: a
chain of one-child nodes lays out as a **vertical column**. Every aesthetic
guarantee RT offers is satisfied — parents centred, no overlaps, minimal width —
and the picture is still wrong, because lists read left to right. A correct
algorithm applied to the wrong question.

**Reuse tidy-tree and rotate the result 90°.** Rejected: the wrapping is the
actual problem. A thirty-node list has to fold, and a rotated tree layout has no
concept of a row, so the fold would have to be bolted on afterwards — at which
point nothing of RT is left but the coordinate assignment, which is the easy
part.

**Add a `horizontal` option to the tree renderer.** Rejected: the value display
differs too (boxes with a terminator, not circles), as do the edge routes (arcs
around a wrap, `prev` below the row) and the chip stacking. That is not an
option, it is a second renderer wearing the first one's name.

**Lay out in the list's current logical order.** Rejected, and this is the
interesting one. Reversal would then slide all six boxes past each other on
every step — showing a rearrangement that never happened. Fixing positions by
creation order instead means the boxes stay put and only the arrows flip, which
is precisely what the algorithm does to the data. The static skeleton (ADR 0006)
turns out to be the *pedagogically* right answer here, not merely the stable
one.

## Consequences

- `RENDERERS/LINKED_LIST.md` §1 said all of this before the code was written.
  Two other documents contradicted it, and the contradiction survived until a
  renderer was actually built. Cheap specs are only cheap if they are read.
- The estimate was wrong in the useful direction: B2 was ~150 new lines rather
  than free, and B1 was genuinely free reuse.
- `prev` edges draw below the row and `next` above. Both on one line turns a
  doubly linked list into a ladder nobody can follow.
- An unreachable node is dimmed and labelled rather than dropped. Mid-reversal
  the detached half is a real state of the algorithm, and hiding it would make a
  correct intermediate look like a node vanishing.
