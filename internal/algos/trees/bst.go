package trees

import (
	_ "embed"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed bst.go
var bstSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "bst-insert",
		Title:  "BST Insert",
		Family: "Trees",
		Blurb:  "Every value walks down from the root until it finds the empty slot that belongs to it.",
		Inputs: []algos.InputSpec{
			{Name: "values", Kind: "intList", Max: 12, Default: []int{8, 10, 3, 14, 6, 1, 13, 4, 7},
				Help: "up to 12 numbers, inserted in this order"},
		},
		Defaults: algos.Args{"values": []int{8, 10, 3, 14, 6, 1, 13, 4, 7}},
		Source:   trace.Source{Path: "internal/algos/trees/bst.go", Text: bstSrc, FirstLine: 1},
		Tags:     []string{"tree", "bst", "pointers"},
		Run:      runBSTInsert,
	})
}

// The default input inserts 10 before 3 on purpose.
//
// 10 is the RIGHT child of 8 and is created first, so if the picture were laid
// out in insertion order it would appear on the left — and the drawing would
// contradict the code. It does not, because `order: ["left","right"]` in the
// schema fixes the draw order independently of when each child arrives. That is
// the whole reason the field exists, and this input is the case that proves it.
//
// It also produces two single-child nodes: 10 has only a right child and 14 has
// only a left. Both must visibly lean, because "this subtree has nothing on the
// left" is the fact the next descent depends on. RENDERERS/TREE.md 3.
func runBSTInsert(tr *tracer.Tracer, args algos.Args) error {
	vals := args.Ints("values")

	t := tr.Nodes("tree", binaryTree("root", "cur"))
	tr.View("tree", "tree", 0, tracer.Title("binary search tree"))

	root := ""
	for _, v := range vals {
		if root == "" {
			id, _ := t.New(trace.Record{"val": v})
			t.Ref("root", id).Because("%d becomes the root", v)
			root = id
			continue
		}

		// The descent. Each hop is a write to `cur`, so it is a STEP with an
		// explanation — the pointer moving IS the algorithm here, and without
		// promoting it to a write the whole search would collapse into a single
		// invisible jump to the insertion point. FLAWS.md 1, ADR 0003.
		cur := root
		for {
			cv := val(t, cur)
			t.Ref("cur", cur).
				Because("compare %d with %d", v, cv).
				From(t.Cell(cur, "val"))

			field := "right"
			if v < cv {
				field = "left"
			}
			if v == cv {
				// A duplicate is not an error and not a new node. Identity in
				// this structure is the node id, never the value, so silently
				// creating a second node holding 8 would draw two 8s and be
				// indistinguishable from a bug. RENDERERS/TREE.md 6.
				t.Ref("cur", "").Note("%d is already in the tree", v)
				break
			}

			next := t.Ptr(cur, field)
			if next == "" {
				// Landing the node and lifting the cursor are ONE step. They
				// are one fact -- this value is placed and the search is over --
				// and splitting them leaves the cursor parked on a node the
				// algorithm has finished with. It also keeps the next value's
				// descent honest: without the lift, a value that also starts at
				// the root would re-write `cur` with the id it already holds,
				// producing a step in which nothing on screen changes. V11 flags
				// exactly that.
				parent := cur
				tr.Group(func() {
					id, _ := t.New(trace.Record{"val": v})
					t.Link(parent, field, id)
					t.Ref("cur", "")
				}).Note("%d %s %d, so it goes in the empty %s slot",
					v, cmp(v, cv), cv, field)
				break
			}
			cur = next
		}
	}

	return tr.Err()
}

func cmp(a, b int) string {
	if a < b {
		return "<"
	}
	return ">"
}
