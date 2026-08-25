package trees

import (
	_ "embed"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed inorder.go
var inorderSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "tree-inorder",
		Title:  "Inorder Traversal",
		Family: "Trees",
		Blurb:  "Left subtree, then the node, then the right. On a BST that reads the values out in sorted order.",
		Inputs: []algos.InputSpec{
			{
				Name: "tree", Kind: "tree", Notation: "leetcode", Max: 63,
				Default: []any{4, 2, 7, 1, 3, 6, 9},
				Help:    "LeetCode level order, e.g. [1,2,null,3,4] — nulls have no children of their own",
			},
		},
		Defaults: algos.Args{"tree": []any{4, 2, 7, 1, 3, 6, 9}},
		Source:   trace.Source{Path: "internal/algos/trees/inorder.go", Text: inorderSrc, FirstLine: 1},
		Tags:     []string{"tree", "recursion", "traversal"},
		Run:      runInorder,
	})
}

// Two things this one exists to show.
//
// The input arrives as LeetCode array notation and is turned into a real tree
// by a CONSTRUCTION PROLOGUE: a run of ordinary writes, before the algorithm
// starts, that a viewer can rewind into and watch. It is genuinely clarifying
// the first time and tedious every time after, so the view declares where the
// prologue ends and the player opens there. RENDERERS/TREE.md 2.3.
//
// And the output array is a second pane fed by the same store, so the tree and
// the sequence it produces are visibly the same run — the `out` cursor and the
// `cur` pointer advance together with no synchronisation code anywhere.
func runInorder(tr *tracer.Tracer, args algos.Args) error {
	toks := args.Tokens("tree")

	t := tr.Nodes("tree", binaryTree("root", "cur"))
	root := buildLeetCode(tr, t, toks)
	if root != "" {
		t.Ref("root", root)
	}

	n := 0
	for _, tok := range toks {
		if tok != nil {
			n++
		}
	}
	out := tr.Array("out", n, nil)
	k := tr.Scalar("k", 0).Aux()

	// StartHere is read AFTER the prologue and before the walk, so the number
	// it records cannot drift when a line is added to the parser.
	tr.View("tree", "tree", 0, tracer.Title("tree"), tracer.StartHere(tr))
	tr.View("linear", "out", 1, tracer.Title("inorder"), tracer.Opt("cursors", []any{"k"}))

	if root == "" {
		return tr.Err()
	}

	i := 0
	var walk func(id string)
	walk = func(id string) {
		if id == "" {
			return
		}
		tr.Call("inorder", tracer.A("node", val(t, id)))
		t.Ref("cur", id).Because("visit %d", val(t, id))

		walk(t.Ptr(id, "left"))

		v := val(t, id)
		out.Set(i, v).Because("%d comes after everything in its left subtree", v).
			From(t.Cell(id, "val"))
		i++
		k.Set(i).Lvl(1)

		walk(t.Ptr(id, "right"))
		tr.Return(v)
	}
	walk(root)

	t.Ref("cur", "").Note("the whole tree has been read out")
	return tr.Err()
}
