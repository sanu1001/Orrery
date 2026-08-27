package lists

import (
	_ "embed"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed partition.go
var partitionSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "list-partition",
		Title:  "Partition a Linked List",
		Family: "Linked lists",
		Blurb:  "Deal every node into one of two chains, then join them. Nothing is compared twice.",
		Inputs: []algos.InputSpec{
			{Name: "values", Kind: "intList", Max: 24, Default: []int{1, 4, 3, 2, 5, 2},
				Help: "up to 24 values"},
			{Name: "x", Kind: "int", Min: -999, Max: 999, Default: 3,
				Help: "values below x come first"},
		},
		Defaults:   algos.Args{"values": []int{1, 4, 3, 2, 5, 2}, "x": 3},
		Source:     trace.Source{Path: "internal/algos/lists/partition.go", Text: partitionSrc, FirstLine: 1},
		Tags:       []string{"list", "pointers", "stable"},
		Complexity: "O(n)",
		Sweep:      []string{"values"},
		Run:        runPartition,
	})
}

// THE TWO TAILS ARE THE ALGORITHM, and they are why this needs a picture more
// than most list problems do.
//
// The obvious approach -- walk the list and move small nodes to the front -- is
// O(n^2) and it is not stable. The trick is to stop treating it as one list:
// deal every node into one of TWO chains, in order, and then join them. Each
// node is looked at once, relative order survives inside each chain, and the
// join is a single pointer write.
//
// Four named pointers hold that in place: the head and tail of each chain. The
// renderer draws all four as chips on whatever node they point at, so the two
// chains being built are visible at once -- and the moment they join, the
// picture becomes one list again with no nodes having moved.
//
// `reflow: "final"` for the same reason list-merge uses it: this genuinely
// reorders, so creation order would draw every arrow crossing the pane.
func runPartition(tr *tracer.Tracer, args algos.Args) error {
	vals := args.Ints("values")
	x := args.Int("x")

	l := tr.Nodes("list", singly("head", "cur", "lo", "loTail", "hi", "hiTail"))
	head := build(tr, l, vals, false)
	if head != "" {
		l.Ref("head", head)
	}
	tr.View("linkedList", "list", 0,
		tracer.Title("partition around "+itoa(x)),
		tracer.Opt("reflow", "final"),
		tracer.StartHere(tr))

	if head == "" {
		return tr.Err()
	}

	loHead, loTail, hiHead, hiTail := "", "", "", ""
	for cur := head; cur != ""; {
		v := val(l, cur)
		next := l.Ptr(cur, "next")
		low := v < x

		// Captured before the group writes anything: after the relink `cur` is
		// the tail of its chain, and citing its own new position as the reason
		// it went there would be circular.
		reason := l.Cell(cur, "val")
		node, tailName := cur, "hiTail"
		prev := hiTail
		if low {
			tailName, prev = "loTail", loTail
		}
		first := prev == ""

		tr.Group(func() {
			l.Ref("cur", node)
			if first {
				// The first node of a chain has no predecessor to link from, so
				// the chain's head pointer is what records it. Both heads are
				// written exactly once in the whole run.
				l.Ref(headName(low), node).
					Because("%d %s %d", v, cmpWord(low), x).
					From(reason)
			} else {
				linkIf(tr, l, prev, "next", node).
					Because("%d %s %d", v, cmpWord(low), x).
					From(reason)
			}
			l.Ref(tailName, node)
		}).Note("%d goes on the %s chain", v, sideWord(low))

		if low {
			if first {
				loHead = node
			}
			loTail = node
		} else {
			if first {
				hiHead = node
			}
			hiTail = node
		}
		cur = next
	}

	// THE JOIN, and the one write that can go wrong. The low chain's last node
	// still points at whatever followed it in the ORIGINAL list, which is now
	// somewhere in the middle of the high chain -- so failing to overwrite it
	// leaves a cycle, and failing to terminate the high chain leaves the tail
	// pointing back into the middle of the list.
	newHead := loHead
	if newHead == "" {
		newHead = hiHead
	}
	tr.Group(func() {
		if hiTail != "" {
			linkIf(tr, l, hiTail, "next", "")
		}
		if loTail != "" && hiHead != "" {
			linkIf(tr, l, loTail, "next", hiHead)
		}
		refIf(tr, l, "head", newHead)
		refIf(tr, l, "cur", "")
		refIf(tr, l, "loTail", "")
		refIf(tr, l, "hiTail", "")
	}).Note("%s", joinNote(loHead, hiHead, x))
	return tr.Err()
}

func joinNote(loHead, hiHead string, x int) string {
	switch {
	case loHead == "":
		return "nothing is below " + itoa(x) + ", so the order is unchanged"
	case hiHead == "":
		return "everything is below " + itoa(x) + ", so the order is unchanged"
	}
	return "join the two chains, and terminate the second one"
}

func headName(low bool) string {
	if low {
		return "lo"
	}
	return "hi"
}

func cmpWord(low bool) string {
	if low {
		return "<"
	}
	return ">="
}

func sideWord(low bool) string {
	if low {
		return "low"
	}
	return "high"
}
