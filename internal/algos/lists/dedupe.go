package lists

import (
	_ "embed"
	"sort"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed dedupe.go
var dedupeSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "list-dedupe",
		Title:  "Remove Duplicates from a Sorted List",
		Family: "Linked lists",
		Blurb:  "Walk once, and splice out every node that repeats the one before it.",
		Inputs: []algos.InputSpec{
			{Name: "values", Kind: "intList", Max: 24, Default: []int{1, 1, 2, 3, 3, 3, 4, 5, 5},
				Help: "sorted on the way in, so duplicates are adjacent"},
		},
		Defaults:   algos.Args{"values": []int{1, 1, 2, 3, 3, 3, 4, 5, 5}},
		Source:     trace.Source{Path: "internal/algos/lists/dedupe.go", Text: dedupeSrc, FirstLine: 1},
		Tags:       []string{"list", "pointers", "deletion"},
		Complexity: "O(n)",
		Sweep:      []string{"values"},
		Run:        runDedupe,
	})
}

// Deletion, which is the one list operation the other two never perform.
//
// The bypass and the removal are ONE step, and that pairing is the whole point:
// the node fades out at the same moment the arrow reaches over it. In two steps
// you would see either a node dangling off the chain or an arrow pointing at
// something already gone, and both look like bugs.
//
// The renderer is told nothing about deletion. It sees a `set` whose `to` is
// null, which is the exit animation, and a `next` pointer that now names a
// different node, which is the new edge. TRACE_FORMAT.md 4.2 dispatches on the
// shape of the delta, never on an event that says "this is a removal".
func runDedupe(tr *tracer.Tracer, args algos.Args) error {
	vals := append([]int(nil), args.Ints("values")...)
	// Sorted here rather than demanded of the caller: the algorithm is only
	// correct on sorted input, and silently doing the wrong thing on unsorted
	// input teaches the wrong lesson.
	sort.Ints(vals)

	l := tr.Nodes("list", singly("head", "cur"))
	head := build(tr, l, vals, false)
	if head != "" {
		l.Ref("head", head)
	}
	tr.View("linkedList", "list", 0, tracer.Title("list"), tracer.StartHere(tr))
	if head == "" {
		return tr.Err()
	}

	cur := head
	l.Ref("cur", cur)
	// `cur` is written only where it actually MOVES, not at the top of the loop.
	// After a splice the walk stays on the same node to check the next
	// duplicate, and re-writing the pointer with the id it already holds would
	// add a step in which nothing on screen changes. V11 flags exactly that.
	for cur != "" {
		next := l.Ptr(cur, "next")
		if next == "" {
			break
		}
		if val(l, cur) == val(l, next) {
			after := l.Ptr(next, "next")
			dup := val(l, next)
			tr.Group(func() {
				if after == "" {
					l.Unlink(cur, "next")
				} else {
					l.Link(cur, "next", after)
				}
				l.Delete(next)
			}).Note("a second %d, so splice it out", dup)
			continue // stay put: the next node may repeat as well
		}
		cur = next
		l.Ref("cur", cur)
	}

	l.Ref("cur", "").Note("every run of duplicates is down to one node")
	return tr.Err()
}
