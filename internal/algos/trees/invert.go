package trees

import (
	_ "embed"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed invert.go
var invertSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "tree-invert",
		Title:  "Invert a Binary Tree",
		Family: "Trees",
		Blurb:  "Swap every node's children. Four lines, and the picture turns inside out.",
		Inputs: []algos.InputSpec{
			{
				Name: "tree", Kind: "tree", Notation: "leetcode", Max: 63,
				Default: []any{4, 2, 7, 1, 3, 6, 9},
				Help:    "LeetCode level order, e.g. [1,2,null,3,4] — nulls have no children of their own",
			},
		},
		Defaults:   algos.Args{"tree": []any{4, 2, 7, 1, 3, 6, 9}},
		Source:     trace.Source{Path: "internal/algos/trees/invert.go", Text: invertSrc, FirstLine: 1},
		Tags:       []string{"tree", "recursion", "pointers"},
		Complexity: "O(n)",
		Sweep:      []string{"tree"},
		Run:        runInvert,
	})
}

// THIS IS THE TREE'S ANSWER TO list-reverse, and it makes the same point about
// layout from the opposite direction.
//
// Reversing a list rewrites pointers and moves no boxes, because the layout
// comes from creation order. Inverting a tree rewrites pointers and DOES move
// nodes, because a tree's layout comes from the shape the pointers make -- and
// that is right: an inverted tree genuinely is a different picture, and drawing
// it in the old positions would be the lie.
//
// RENDERERS/TREE.md 3.1 is where that lives. The layout is reused while the
// current edges remain a SUBSET of the final shape, and recomputed the moment
// they are not. A swap is not a subset, so every swap re-lays out and the
// affected subtree slides across -- which is exactly the movement the algorithm
// performs on the data.
//
// Recursive, with call and ret events, so the call-stack pane shows the descent
// and the unwinding. That is the whole difference between this and an iterative
// version, and it is worth showing once.
func runInvert(tr *tracer.Tracer, args algos.Args) error {
	toks := args.Tokens("tree")

	t := tr.Nodes("tree", binaryTree("root", "cur"))
	root := buildLeetCode(tr, t, toks)
	if root != "" {
		t.Ref("root", root)
	}

	tr.View("tree", "tree", 0, tracer.Title("tree"), tracer.StartHere(tr))

	if root == "" {
		return tr.Err()
	}

	var invert func(id string)
	invert = func(id string) {
		if id == "" {
			return
		}
		v := val(t, id)
		tr.Call("invert", tracer.A("node", v))
		t.Ref("cur", id)

		l, r := t.Ptr(id, "left"), t.Ptr(id, "right")
		if l != "" || r != "" {
			// BOTH WRITES IN ONE STEP. Left to separate steps there is a frame in
			// which the same child is on both sides -- the tree renderer draws
			// both edges, correctly, and the picture shows a node with two
			// parents, which reads as the bug it is not.
			tr.Group(func() {
				setChild(t, id, "left", r)
				setChild(t, id, "right", l)
			}).Note("%s", swapNote(t, v, l, r))
		}

		invert(l)
		invert(r)
		tr.Return(v)
	}
	invert(root)

	t.Ref("cur", "").Note("every node has had its children swapped")
	return tr.Err()
}

// setChild links or unlinks, whichever the target calls for. Unlink is not a
// special case in the format -- it is a write of null -- but it is a special
// case in the API, so this hides the branch rather than repeating it.
func setChild(t *tracer.Nodes, id, field, target string) {
	if target == "" {
		t.Unlink(id, field)
		return
	}
	t.Link(id, field, target)
}

func swapNote(t *tracer.Nodes, v int, l, r string) string {
	switch {
	case l != "" && r != "":
		return itoa(v) + "'s children swap sides: " + itoa(val(t, l)) + " and " + itoa(val(t, r))
	case l != "":
		return itoa(val(t, l)) + " moves from " + itoa(v) + "'s left to its right"
	default:
		return itoa(val(t, r)) + " moves from " + itoa(v) + "'s right to its left"
	}
}
