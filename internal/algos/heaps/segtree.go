package heaps

import (
	_ "embed"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed segtree.go
var segtreeSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "segtree",
		Title:  "Segment Tree (range sum)",
		Family: "Trees",
		Blurb:  "Every node holds the sum of a range, so a query touches a handful of nodes instead of the whole array.",
		Inputs: []algos.InputSpec{
			{Name: "values", Kind: "intList", Max: 16,
				Default: []int{3, 1, 4, 1, 5, 9, 2, 6},
				Help:    "up to 16 values; padded to a power of two"},
			{Name: "lo", Kind: "int", Min: 0, Max: 15, Default: 2,
				Help: "first index of the range to sum"},
			{Name: "hi", Kind: "int", Min: 0, Max: 15, Default: 6,
				Help: "last index of the range to sum"},
		},
		Defaults: algos.Args{
			"values": []int{3, 1, 4, 1, 5, 9, 2, 6}, "lo": 2, "hi": 6,
		},
		Source:     trace.Source{Path: "internal/algos/heaps/segtree.go", Text: segtreeSrc, FirstLine: 1},
		Tags:       []string{"tree", "array", "range-query"},
		Complexity: "O(log n)",
		// No Sweep. Padding to a power of two makes the tree size a STAIRCASE in
		// the input length -- n = 5 and n = 8 build the identical tree -- and a
		// curve fitted through a staircase says something about the padding
		// rather than about the algorithm. A measurement that cannot mean
		// anything is worse than no measurement. ROADMAP C3.
		Run: runSegtree,
	})
}

// A SEGMENT TREE IS THE OTHER HALF OF THE ARRAY/TREE DUALITY, and it is the
// half where the tree reading is the one that explains the algorithm.
//
// Heapsort's tree shows you why the swaps are correct. Here the tree shows you
// why the QUERY is fast: summing a[2..6] touches four nodes out of fifteen, and
// the picture makes the count obvious in a way that the row of cells cannot.
// The row still earns its pane -- it is where the answer lives, and it is the
// thing being summed.
//
// Same mechanism as the heap and no new machinery: one `kind:"array"`
// structure, `alsoAs: "tree"`, implicit children at 2i+1 and 2i+2. What it adds
// is `subLabelOf`, a map from node index to the range that node covers. The
// range is DATA the algorithm writes during construction, not something the
// renderer derives -- deriving it would mean knowing this particular tree's
// splitting convention, which is algorithm knowledge and forbidden (I2).
func runSegtree(tr *tracer.Tracer, args algos.Args) error {
	vals := args.Ints("values")
	if len(vals) == 0 {
		vals = []int{0}
	}
	// Padded to a power of two so the tree is PERFECT: 2p-1 nodes, every leaf at
	// the same depth, no gaps in the picture. The 4n-slot form used by most
	// implementations leaves more than half the array empty, and drawing those
	// empty slots would make the shape harder to read than the algorithm is.
	p := 1
	for p < len(vals) {
		p *= 2
	}
	lo, hi := clampRange(args.Int("lo"), args.Int("hi"), len(vals))

	a := tr.Array("a", len(vals), 0)
	a.Fill(vals)
	t := tr.Array("t", 2*p-1, 0)
	span := tr.Map("span", "")
	at := tr.Scalar("at", -1).Aux()
	used := tr.Map("used", false)
	acc := tr.Scalar("sum", 0)

	// Spans are fixed geometry, so they all land in one construction step. The
	// alternative -- writing each node's range as the build reaches it -- makes
	// the label appear a step before the value and reads as a glitch.
	tr.Group(func() {
		var mark func(node, l, r int)
		mark = func(node, l, r int) {
			span.Set(itoa(node), itoa(l)+".."+itoa(r))
			if l == r {
				return
			}
			m := (l + r) / 2
			mark(2*node+1, l, m)
			mark(2*node+2, m+1, r)
		}
		mark(0, 0, p-1)
	}).Note("every node covers a range, and the ranges never change")

	tr.View("linear", "t", 0,
		tracer.Title("the segment tree"),
		tracer.Opt("alsoAs", "tree"),
		tracer.Opt("openAs", "tree"),
		tracer.Opt("subLabelOf", "span"),
		tracer.Opt("markOf", "used"),
		tracer.Opt("cursors", []any{"at"}),
		tracer.StartHere(tr))
	tr.View("linear", "a", 1,
		tracer.Title("the values being summed"),
		tracer.Opt("chips", []any{"sum"}),
		tracer.Opt("regions", []any{
			map[string]any{"name": "query", "from": lo, "to": hi, "style": "cursor"},
		}))

	// --- build ---
	var build func(node, l, r int)
	build = func(node, l, r int) {
		if l == r {
			v := 0
			if l < len(vals) {
				v = a.Int(l)
				t.Set(node, v).
					Because("a leaf holds one element").
					From(a.Cell(l))
			} else {
				// The padding. Zero is the identity for a sum, so the padded
				// leaves cost nothing and the tree stays perfect. A different
				// combining operation would need a different identity, which is
				// the reason this is written rather than assumed.
				t.Set(node, 0).Note("padding: outside the input, and zero adds nothing")
			}
			return
		}
		m := (l + r) / 2
		build(2*node+1, l, m)
		build(2*node+2, m+1, r)
		left, right := t.Int(2*node+1), t.Int(2*node+2)
		t.Set(node, left+right).
			Because("%d + %d", left, right).
			From(t.Cell(2*node+1), t.Cell(2*node+2))
	}
	build(0, 0, p-1)

	// --- query ---
	var query func(node, l, r int) int
	query = func(node, l, r int) int {
		at.Set(node).Note("look at the node covering %d..%d", l, r)
		switch {
		case r < lo || hi < l:
			// A DISJOINT NODE IS THE INTERESTING REJECTION, and it is a step only
			// because `at` moved. Nothing is written, nothing is added, and the
			// whole subtree below it is skipped -- which is where the logarithm
			// comes from.
			return 0

		case lo <= l && r <= hi:
			v := t.Int(node)
			was := acc.Int()
			tr.Group(func() {
				used.Set(itoa(node), true)
				acc.Set(was+v).
					Because("%d + %d, the whole of %d..%d", was, v, l, r).
					From(t.Cell(node))
			}).Note("%d..%d is entirely inside the query -- take its sum whole", l, r)
			return v
		}
		m := (l + r) / 2
		return query(2*node+1, l, m) + query(2*node+2, m+1, r)
	}
	total := query(0, 0, p-1)

	tr.Group(func() {
		at.Set(-1)
	}).Note("a[%d..%d] sums to %d, from %d nodes out of %d", lo, hi, total, countUsed(used, 2*p-1), 2*p-1)
	return tr.Err()
}

// clampRange keeps the query inside the input. The bounds in Spec.Inputs cap
// each endpoint independently, so lo > hi and hi past the end both arrive here
// as legal input -- the security boundary cannot express a relation BETWEEN two
// fields, only a range for each.
func clampRange(lo, hi, n int) (int, int) {
	if hi > n-1 {
		hi = n - 1
	}
	if lo > hi {
		lo = hi
	}
	if lo < 0 {
		lo = 0
	}
	return lo, hi
}

func countUsed(used *tracer.Map, n int) int {
	c := 0
	for i := 0; i < n; i++ {
		if used.At(itoa(i)) == true {
			c++
		}
	}
	return c
}
