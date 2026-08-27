package lists

import (
	_ "embed"
	"sort"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed merge.go
var mergeSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "list-merge",
		Title:  "Merge Two Sorted Lists",
		Family: "Linked lists",
		Blurb:  "Take the smaller head each time. No node is created and no value is copied — only arrows move.",
		Inputs: []algos.InputSpec{
			{Name: "a", Kind: "intList", Max: 20, Default: []int{1, 4, 7, 9},
				Help: "sorted automatically"},
			{Name: "b", Kind: "intList", Max: 20, Default: []int{2, 3, 8, 10, 12},
				Help: "sorted automatically"},
		},
		Defaults:   algos.Args{"a": []int{1, 4, 7, 9}, "b": []int{2, 3, 8, 10, 12}},
		Source:     trace.Source{Path: "internal/algos/lists/merge.go", Text: mergeSrc, FirstLine: 1},
		Tags:       []string{"list", "pointers", "merge"},
		Complexity: "O(n)",
		Sweep:      []string{"a", "b"},
		Run:        runListMerge,
	})
}

// THIS IS THE ALGORITHM `reflow: "final"` EXISTS FOR, and it is the exact
// opposite of list-reverse.
//
// Reversing keeps every node where it was and flips the arrows, so the layout
// stays in CREATION order and the picture is honest: the data did not move,
// only the links did. Merging genuinely interleaves two chains, and creation
// order would draw the result as two blocks with every arrow crossing between
// them -- correct, unreadable, and a worse picture than the algorithm deserves.
//
// So this view declares `reflow: "final"`, which lays the nodes out along the
// FINISHED chain. RENDERERS/LINKED_LIST.md 3 offers both and says the choice is
// per algorithm; these two files are why.
//
// Both lists live in one `nodes` structure, because after the merge they ARE
// one list. Two structures would need two panes and the result would belong to
// neither.
func runListMerge(tr *tracer.Tracer, args algos.Args) error {
	av := append([]int(nil), args.Ints("a")...)
	bv := append([]int(nil), args.Ints("b")...)
	sort.Ints(av)
	sort.Ints(bv)

	l := tr.Nodes("list", singly("head", "a", "b", "tail"))
	// Ids must be unique across BOTH lists -- they are the identity the layout
	// works from -- so the second build starts where the first stopped.
	ln := tr.CallerLine(1)
	ha := buildAt(tr, l, av, false, 0, ln)
	hb := buildAt(tr, l, bv, false, len(av), ln)

	tr.Group(func() {
		if ha != "" {
			l.Ref("a", ha)
		}
		if hb != "" {
			l.Ref("b", hb)
		}
	}).Note("two sorted lists, each with its own head")

	tr.View("linkedList", "list", 0,
		tracer.Title("merging"),
		tracer.Opt("reflow", "final"),
		tracer.StartHere(tr))

	a, b := ha, hb
	if a == "" || b == "" {
		// One empty list means the answer is the other one, and the whole merge
		// is a single pointer write. Worth tracing rather than special-casing
		// into silence: it is the base case, and it is where the loop below
		// ends up anyway.
		head := a
		if head == "" {
			head = b
		}
		l.Ref("head", head).Note("one list is empty -- the answer is the other one")
		return tr.Err()
	}

	// Pick the smaller head. Everything after this appends to `tail`, so the
	// first step is the only one that writes `head`.
	var head, took string
	if val(l, a) <= val(l, b) {
		head, took, a = a, "a", l.Ptr(a, "next")
	} else {
		head, took, b = b, "b", l.Ptr(b, "next")
	}
	tail := head
	moved := a
	if took == "b" {
		moved = b
	}
	tr.Group(func() {
		l.Ref("head", head)
		l.Ref("tail", head)
		// ONLY the pointer that moved. Rewriting the other one with the value it
		// already holds is check V11, and it claims a change the picture does
		// not make.
		l.Ref(took, moved)
	}).Note("%d is the smaller of the two heads, so it starts the merged list", val(l, head))

	for a != "" && b != "" {
		va, vb := val(l, a), val(l, b)
		take, from := a, "a"
		if vb < va {
			take, from = b, "b"
		}
		next := l.Ptr(take, "next")
		prev := tail

		// THE RELINK AND BOTH POINTER MOVES ARE ONE STEP. Split apart, there is
		// a frame in which `tail` still points at the old end while its `next`
		// already reaches the new one, and the renderer draws a chain that the
		// algorithm is not holding.
		kept, dropped := va, vb
		if from == "b" {
			kept, dropped = vb, va
		}
		linked := l.Ptr(prev, "next") == take
		tr.Group(func() {
			// TWO CONSECUTIVE TAKES FROM THE SAME LIST NEED NO RELINK AT ALL --
			// the arrow between them was already there, put in by whoever built
			// the list. Writing it again would be check V11 and, worse, would
			// claim a change the picture does not make. It is also the reason
			// merging is cheap: on sorted-ish input most steps move a pointer
			// and touch nothing else.
			if !linked {
				l.Link(prev, "next", take)
			}
			l.Ref("tail", take).
				Because("%d <= %d", kept, dropped).
				From(l.Cell(a, "val"), l.Cell(b, "val"))
			l.Ref(from, next)
		}).Note("%s", takeNote(kept, from, linked))

		tail = take
		if from == "a" {
			a = next
		} else {
			b = next
		}
	}

	// WHATEVER IS LEFT IS ALREADY SORTED AND ALREADY LINKED, so the tail of the
	// merge points at it once and the rest costs nothing. Walking it node by
	// node would be the same picture drawn slowly.
	rest, side := a, "a"
	if rest == "" {
		rest, side = b, "b"
	}
	prev := tail
	tr.Group(func() {
		if rest != "" {
			l.Link(prev, "next", rest)
			l.Ref(side, "")
		}
		l.Ref("tail", "")
	}).Note("%s", endNote(rest, side))
	return tr.Err()
}

func takeNote(v int, from string, linked bool) string {
	if linked {
		return "take " + itoa(v) + " from list " + from + " -- it already follows"
	}
	return "take " + itoa(v) + " from list " + from
}

func endNote(rest, side string) string {
	if rest == "" {
		return "both lists are exhausted, and the merged list is complete"
	}
	return "list " + other(side) + " is empty, so the rest of " + side + " follows unchanged"
}

func other(s string) string {
	if s == "a" {
		return "b"
	}
	return "a"
}
