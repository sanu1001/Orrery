package trees

import (
	_ "embed"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed levelorder.go
var levelorderSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "tree-levelorder",
		Title:  "Level-Order Traversal",
		Family: "Trees",
		Blurb:  "A queue instead of a stack, and the tree comes out one row at a time.",
		Inputs: []algos.InputSpec{
			{
				Name: "tree", Kind: "tree", Notation: "leetcode", Max: 63,
				Default: []any{4, 2, 7, 1, 3, 6, 9},
				Help:    "LeetCode level order, e.g. [1,2,null,3,4] — nulls have no children of their own",
			},
		},
		Defaults:   algos.Args{"tree": []any{4, 2, 7, 1, 3, 6, 9}},
		Source:     trace.Source{Path: "internal/algos/trees/levelorder.go", Text: levelorderSrc, FirstLine: 1},
		Tags:       []string{"tree", "queue", "traversal"},
		Complexity: "O(n)",
		Sweep:      []string{"tree"},
		Run:        runLevelOrder,
	})
}

// THE POINT OF PUTTING THIS BESIDE tree-inorder is that the two algorithms
// differ in exactly one thing -- a queue instead of a stack -- and the trace
// makes that the only visible difference too.
//
// So the second pane is the QUEUE rather than the output. The output of a
// traversal is a list of numbers, and a list of numbers appearing in a
// different order is a weak picture of why the order is different. Watching
// nodes enter one end of the queue and leave the other, with the visit number
// stamped on the edge into each node as it goes, shows the mechanism instead of
// the result.
//
// `edgeLabel: "ord"` is what puts the number on the edge, and `ord` is an
// ordinary scalar field on the node -- the renderer reads a field name out of
// the view options and draws whatever it finds. It has no idea it is showing a
// visit order.
//
// One consequence, and it is fine: the root has no incoming edge, so its own
// visit number is not drawn. The root is always visit 1, so nothing is lost,
// and labelling edges rather than nodes is what keeps the number away from the
// value it would otherwise crowd.
func runLevelOrder(tr *tracer.Tracer, args algos.Args) error {
	toks := args.Tokens("tree")

	t := tr.Nodes("tree", treeWithOrder("root", "cur"))
	root := buildLeetCode(tr, t, toks)
	if root != "" {
		t.Ref("root", root)
	}

	n := countNodes(toks)
	// The queue never holds more than one level plus a partial next one, but
	// sizing it to n is the honest bound and it costs nothing: the cells are
	// sparse and read through to the fill.
	q := tr.Array("queue", n, nil)
	head := tr.Scalar("head", 0).Aux()
	tail := tr.Scalar("tail", 0).Aux()

	tr.View("tree", "tree", 0,
		tracer.Title("tree"),
		tracer.Opt("edgeLabel", "ord"),
		tracer.StartHere(tr))
	tr.View("linear", "queue", 1,
		tracer.Title("queue"),
		tracer.Opt("cursors", []any{"head", "tail"}),
		tracer.Opt("regions", []any{
			map[string]any{"name": "waiting", "from": "head", "to": "tail", "style": "cursor"},
		}))

	if root == "" {
		return tr.Err()
	}

	// A RING BUFFER WOULD BE WRONG HERE, and the reason is about the picture
	// rather than about memory. Wrapping means a node's slot is reused, so the
	// cell that held 4 at step 3 holds 9 at step 11 -- and the array stops being
	// a record of what happened. Straight-line indices keep every enqueue
	// visible for the whole run, which is what makes the shape of the traversal
	// readable after the fact.
	tr.Group(func() {
		q.Set(0, val(t, root))
		tail.Set(1)
	}).Note("the root is the only thing waiting")

	ids := []string{root}
	visited := 0
	for h := 0; h < len(ids); h++ {
		id := ids[h]
		kids := children(t, id)
		v := val(t, id)

		tr.Group(func() {
			t.Ref("cur", id)
			t.SetField(id, "ord", visited+1).
				Because("taken off the front of the queue").
				From(q.Cell(h))
			head.Set(h + 1)
		}).Note("visit %d is %d", visited+1, v)
		visited++

		for _, c := range kids {
			cv := val(t, c)
			slot := len(ids)
			ids = append(ids, c)
			tr.Group(func() {
				q.Set(slot, cv)
				tail.Set(slot + 1)
			}).Note("%d joins the back of the queue", cv)
		}
	}

	t.Ref("cur", "").
		Note("the queue is empty -- every node has been visited once")
	return tr.Err()
}

// treeWithOrder is the binary-tree schema plus the visit-number field the edge
// labels read. Declared rather than written ad hoc: a field the schema does not
// name is a field the renderer will not look for.
func treeWithOrder(refs ...string) trace.Schema {
	s := binaryTree(refs...)
	s.Fields["ord"] = trace.FScalar
	return s
}
