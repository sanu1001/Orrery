package trees

import (
	_ "embed"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed lca.go
var lcaSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "tree-lca",
		Title:  "Lowest Common Ancestor",
		Family: "Trees",
		Blurb:  "Each call reports what it found below it, and the first node to hear about both is the answer.",
		Inputs: []algos.InputSpec{
			{
				Name: "tree", Kind: "tree", Notation: "leetcode", Max: 63,
				Default: []any{4, 2, 7, 1, 3, 6, 9},
				Help:    "LeetCode level order, e.g. [1,2,null,3,4] — nulls have no children of their own",
			},
			{Name: "p", Kind: "int", Min: -999, Max: 999, Default: 1},
			{Name: "q", Kind: "int", Min: -999, Max: 999, Default: 3},
		},
		Defaults:   algos.Args{"tree": []any{4, 2, 7, 1, 3, 6, 9}, "p": 1, "q": 3},
		Source:     trace.Source{Path: "internal/algos/trees/lca.go", Text: lcaSrc, FirstLine: 1},
		Tags:       []string{"tree", "recursion", "divide-and-conquer"},
		Complexity: "O(n)",
		Sweep:      []string{"tree"},
		Run:        runLCA,
	})
}

// THE RETURN VALUE IS THE ALGORITHM, which makes this the tree case where the
// recursion pane earns its place.
//
// Every call answers one question about the subtree below it -- "did you find
// either of them, and if so which" -- and the answer travels back UP. A node
// that hears from both sides is the lowest common ancestor, and nothing else in
// the tree can be: anything lower saw at most one of them, anything higher
// heard about both through a single child.
//
// So the interesting events here are `ret`, not `set`. The tree pane shows
// where the walk is; the recursion pane shows what each finished call reported,
// and the answer appears as the first node whose two children both came back
// with something. Reading it in the tree alone would mean inferring the
// returns, which is exactly the work the second pane removes.
func runLCA(tr *tracer.Tracer, args algos.Args) error {
	toks := args.Tokens("tree")
	p, q := args.Int("p"), args.Int("q")

	t := tr.Nodes("tree", binaryTree("root", "cur", "lca"))
	root := buildLeetCode(tr, t, toks)
	if root != "" {
		t.Ref("root", root)
	}

	tr.View("tree", "tree", 0, tracer.Title("tree"), tracer.StartHere(tr))
	tr.View("recursionTree", "$calls", 1, tracer.Title("what each call reported"))

	if root == "" {
		return tr.Err()
	}

	var find func(id string) string
	find = func(id string) string {
		// An empty slot is not a call. Recording one would fill the recursion
		// pane with leaves that answer a question nobody asked, and the shape of
		// the search -- which is the thing worth looking at -- would be buried
		// under twice as many nodes as there are real ones.
		if id == "" {
			return ""
		}
		v := val(t, id)
		tr.Call("lca", tracer.A("node", v))
		t.Ref("cur", id).Note("is %d one of the two, or is one of them below it?", v)

		if v == p || v == q {
			// A HIT DOES NOT KEEP LOOKING, and that is the subtle part. If the
			// other value is below this one, this node is still the answer --
			// an ancestor of itself counts -- so there is nothing further down
			// worth finding.
			tr.Return(v).Note("%d is one of the two -- report it upward", v)
			return id
		}

		l := find(t.Ptr(id, "left"))
		r := find(t.Ptr(id, "right"))

		switch {
		case l != "" && r != "":
			tr.Group(func() {
				t.Ref("lca", id)
				t.Ref("cur", id)
			}).Note("%d heard from both sides -- it is the lowest common ancestor", v)
			tr.Return(v).Note("%d is the answer, and it travels up unchanged", v)
			return id
		case l != "":
			tr.Return(val(t, l)).Note("only the left side found anything -- pass it up")
			return l
		case r != "":
			tr.Return(val(t, r)).Note("only the right side found anything -- pass it up")
			return r
		}
		tr.Return(nil).Note("nothing below %d", v)
		return ""
	}

	ans := find(root)
	if ans == "" {
		t.Ref("cur", "").Note("%d and %d are not both in this tree", p, q)
	}
	return tr.Err()
}
