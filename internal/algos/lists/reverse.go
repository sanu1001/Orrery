package lists

import (
	_ "embed"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed reverse.go
var reverseSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "list-reverse",
		Title:  "Reverse a Linked List",
		Family: "Linked lists",
		Blurb:  "Three pointers walk the list once, turning every arrow around behind them.",
		Inputs: []algos.InputSpec{
			{Name: "values", Kind: "intList", Max: 40, Default: []int{1, 2, 3, 4, 5, 6},
				Help: "up to 40 values"},
			{Name: "doubly", Kind: "int", Min: 0, Max: 1, Default: 0,
				Help: "1 to also maintain prev pointers"},
		},
		Defaults:   algos.Args{"values": []int{1, 2, 3, 4, 5, 6}, "doubly": 0},
		Source:     trace.Source{Path: "internal/algos/lists/reverse.go", Text: reverseSrc, FirstLine: 1},
		Tags:       []string{"list", "pointers", "in-place"},
		Complexity: "O(n)",
		Sweep:      []string{"values"},
		Run:        runReverse,
	})
}

// This is the algorithm that proves the layout model is right, and it proves it
// by accident rather than by design.
//
// Node positions come from the UNION in creation order, so they are fixed
// before the first frame. Reversal does not create or move a single node — it
// only rewrites `next` pointers. So the boxes stay exactly where they are and
// every arrow flips, which is precisely what the algorithm does to the data.
// A layout derived from the CURRENT chain order would instead slide all six
// boxes past each other and show a rearrangement that never happened.
// RENDERERS/LINKED_LIST.md 3.
//
// Watch `n0` while it runs: the moment its `next` is cleared it stops being
// reachable from `head`, and the renderer dims it and marks it unreachable
// until `head` catches up. That is a real intermediate state of the algorithm,
// not a rendering artifact.
func runReverse(tr *tracer.Tracer, args algos.Args) error {
	vals := args.Ints("values")
	back := args.Int("doubly") == 1

	sch := singly("head", "prev", "cur")
	if back {
		sch = doubly("head", "prev", "cur")
	}
	l := tr.Nodes("list", sch)

	head := build(tr, l, vals, back)
	if head != "" {
		l.Ref("head", head)
	}
	tr.View("linkedList", "list", 0, tracer.Title("list"), tracer.StartHere(tr))

	if head == "" {
		return tr.Err()
	}

	prev := ""
	cur := head
	l.Ref("cur", cur)
	for cur != "" {
		next := l.Ptr(cur, "next")
		v := val(l, cur)

		// The relink and BOTH pointer moves are one step, which is the whole
		// iteration of the textbook loop:
		//
		//     next = cur.next;  cur.next = prev;  prev = cur;  cur = next
		//
		// Advancing `cur` in the same group matters for more than tidiness. Left
		// to a step of its own, there is an instant where cur still sits on the
		// node whose `next` was just cleared, so nothing downstream is reachable
		// from any pointer and the renderer correctly dims the entire rest of
		// the list -- for one step, then undims it. That flicker is an artifact
		// of where the step boundary fell, not a state the algorithm is ever
		// meaningfully in.
		tr.Group(func() {
			if prev == "" {
				l.Unlink(cur, "next")
			} else {
				l.Link(cur, "next", prev)
			}
			if back {
				if next == "" {
					l.Unlink(cur, "prev")
				} else {
					l.Link(cur, "prev", next)
				}
			}
			l.Ref("prev", cur)
			l.Ref("cur", next)
		}).Note("%d now points back instead of forward", v)

		prev = cur
		cur = next
	}

	// `cur` is already parked: the loop's last iteration advanced it to the nil
	// that ended the walk, so writing it again would be a step in which nothing
	// changes.
	tr.Group(func() {
		l.Ref("head", prev)
		l.Ref("prev", "")
	}).Note("the old tail is the new head")
	return tr.Err()
}
