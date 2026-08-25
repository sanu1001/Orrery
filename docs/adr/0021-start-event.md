# ADR 0021 — The construction prologue is marked by an EVENT, not a step

**Status:** accepted

## Context

Once an algorithm takes a tree or a list as input, the trace has to build that
input first. `tree-inorder` on `[4,2,7,1,3,6,9]` spends its first eleven steps
creating seven nodes and linking them, before a single line of the traversal
runs.

Watching that is genuinely clarifying the first time — it is how you learn that
LeetCode array notation is level-order-with-omissions rather than heap indexing.
It is tedious every time after. So the player should open past it and offer a
way back in.

`RENDERERS/TREE.md` §2.3 specified this as `views[].startStep`.

## Decision

The field is **`views[].startEvent`**: an index into `trace.events`, not into
the step list. The consumer maps it to a step with the binary search it already
has (`stepIndexOf`), and seeks there on load.

The prologue steps stay ordinary steps. Nothing is hidden, nothing is skipped
by the step counter, and rewinding into the prologue is stepping rather than a
special mode. A deep link naming a step inside the prologue still wins: someone
who shared step 3 meant step 3.

The producer records it with `tracer.StartHere(tr)`, which reads the current
event count at the moment it is called rather than taking a number, because
hand-counting events is the kind of thing that silently rots the first time a
line is added to the parser.

## Alternatives

**`startStep`, as specified.** Rejected, and this is the whole ADR: **a producer
cannot know step numbers.** A step is a run of events sharing a group id, *after*
filtering by the viewer's detail level. The same trace has different step
numbers at level 0 and at level 1, and the detail level is a control in the UI —
it can change after load, without the trace changing at all. Any number the
producer wrote would be correct for exactly one of those settings and silently
wrong for the other. The store recomputes `startStep` inside `setLevel` for
precisely this reason.

**Emit the prologue with `lvl: 1` so the detail filter hides it.** Rejected on
two counts. `lvl > 0` is restricted to `aux` structures, and the tree being
built is the opposite of auxiliary — it is the subject. And ADR 0016's soundness
argument depends on that restriction, so widening it here would cost the
guarantee that filtering can never produce a wrong state.

**A separate `meta.prologue: {from, to}`.** Rejected as the same information in
a less useful place: the prologue is a property of a *view* — one pane may be
built while another is not — and `meta.views` is already where per-view
concerns live.

**Trim the prologue out of the trace and rebuild the input silently.** Rejected
outright. The construction is real work the algorithm did, and hiding it makes
the first step of the traversal appear against a tree that materialised from
nowhere. It also breaks reversibility: there would be no `from` values to rewind
into.

## Consequences

- Additive, so no version bump (ADR 0019). Every golden fixture predating the
  change came back byte-identical, which is that policy being exercised rather
  than merely asserted.
- The transport grows one conditional control, shown only when a trace declares
  a prologue — the same pattern as the truncation banner: a control that can do
  nothing is worse than no control.
- Consumers that ignore the field open at step 0 and see the construction. That
  is a worse experience, not a broken one, which is what "additive" has to mean.
- The mapping is recomputed on a detail-level change. A cached step number would
  be wrong the moment someone presses `d`.
