package heaps

import (
	_ "embed"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed heapsort.go
var heapsortSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "heapsort",
		Title:  "Heapsort",
		Family: "Sorting",
		Blurb:  "Build a max-heap in place, then repeatedly move the root to the end.",
		Inputs: []algos.InputSpec{
			{Name: "values", Kind: "intList", Max: 24,
				Default: []int{5, 13, 2, 25, 7, 17, 20, 8, 4},
				Help:    "up to 24 values"},
		},
		Defaults:   algos.Args{"values": []int{5, 13, 2, 25, 7, 17, 20, 8, 4}},
		Source:     trace.Source{Path: "internal/algos/heaps/heapsort.go", Text: heapsortSrc, FirstLine: 1},
		Tags:       []string{"sorting", "heap", "in-place"},
		Complexity: "O(n log n)",
		Sweep:      []string{"values"},
		Run:        runHeapsort,
	})
}

// HEAPSORT IS WHY THE ARRAY/TREE TOGGLE EXISTS.
//
// The array declares `alsoAs: "tree"`, which offers a second READING of the
// same cells with children at 2i+1 and 2i+2. There is no second structure, no
// node ids and no pointer fields -- a heap is an array, and giving it node
// identity would be a lie about the data structure. RENDERERS/LINEAR.md 5.1.
//
// The pair is a better teacher than either half. A sift-down is obviously
// CORRECT in the tree, where you can see the largest child rising past its
// parent, and obviously CHEAP in the array, where the whole operation is a few
// swaps in one contiguous run. Watching only the tree hides why a heap is worth
// having; watching only the array hides what it means.
//
// Nothing moves in either view. The layout comes from the DECLARED length, so
// every position is fixed before the first frame and a sift is values trading
// places between fixed slots -- which is exactly the right mental model, and it
// falls out of the static-skeleton rule rather than being arranged for.
func runHeapsort(tr *tracer.Tracer, args algos.Args) error {
	vals := args.Ints("values")
	n := len(vals)

	a := tr.Array("a", n, 0)
	a.Fill(vals)
	// `size` is NOT aux. It is the boundary between the heap and the sorted
	// output, both views draw it, and a viewer who cannot see it cannot tell
	// why the algorithm stops looking at the tail.
	size := tr.Scalar("size", n)
	root := tr.Scalar("root", -1).Aux()
	pick := tr.Scalar("pick", -1).Aux()

	tr.View("linear", "a", 0,
		tracer.Title("the heap"),
		tracer.Opt("alsoAs", "tree"),
		tracer.Opt("openAs", "tree"),
		tracer.Opt("sizeOf", "size"),
		tracer.Opt("cursors", []any{"root", "pick"}),
		tracer.StartHere(tr))
	// The same structure again, as the row it actually is. Two panes over one
	// store cannot drift, so this costs nothing but the pixels -- and seeing
	// both at once is the whole lesson.
	tr.View("linear", "a", 1,
		tracer.Title("the same cells, as an array"),
		tracer.Opt("cursors", []any{"root", "pick"}),
		tracer.Opt("regions", []any{
			map[string]any{"name": "sorted", "from": "size", "to": n - 1, "style": "settled"},
		}))

	if n < 2 {
		return tr.Err()
	}

	// Floyd's bottom-up build. Starting from the last internal node and working
	// backwards is what makes it O(n) rather than O(n log n): most nodes are
	// near the bottom and sift down a short distance.
	for start := n/2 - 1; start >= 0; start-- {
		siftDown(tr, a, root, pick, start, n)
	}
	for end := n - 1; end > 0; end-- {
		hi := a.Int(0)
		lo := a.Int(end)
		tr.Group(func() {
			a.Set(0, lo)
			a.Set(end, hi).
				Because("the root is the largest of the %d remaining", end+1).
				From(a.Cell(0))
			// Shrinking the heap in the same step is deliberate: left to a step
			// of its own there is one frame in which the sorted value is still
			// inside the heap, and the tree draws it as a live node with a
			// value that outranks everything -- a state the algorithm is never
			// meaningfully in.
			size.Set(end)
		}).Note("%d is settled at index %d", hi, end)
		siftDown(tr, a, root, pick, 0, end)
	}
	tr.Group(func() {
		root.Set(-1)
		pick.Set(-1)
	}).Note("the heap is empty and the array is sorted")
	return tr.Err()
}

// siftDown restores the heap property at `at`, walking it down until both
// children are smaller.
//
// Iterative rather than recursive, and that is a tracing decision as much as a
// style one: the recursive form would put a call/ret pair around every level of
// every sift, which turns a 9-element sort into a call tree of sixty frames
// whose shape says nothing. The loop is the same algorithm with a trace worth
// reading.
func siftDown(tr *tracer.Tracer, a *tracer.Array, root, pick *tracer.Scalar, at, size int) {
	for {
		best := at
		l, r := 2*at+1, 2*at+2
		if l < size && a.Int(l) > a.Int(best) {
			best = l
		}
		if r < size && a.Int(r) > a.Int(best) {
			best = r
		}

		// Both cursor writes in one group, so "look here, and this is the
		// largest of the three" is one step. Each is skipped when it would not
		// change -- check V11, and a step whose state does not move.
		cells := []tracer.Cell{a.Cell(at)}
		if l < size {
			cells = append(cells, a.Cell(l))
		}
		if r < size {
			cells = append(cells, a.Cell(r))
		}
		tr.Group(func() {
			setIf(root, at)
			setIf(pick, best).
				Because("largest of a[%d] and its children", at).
				From(cells...)
		}).Note("%s", pickNote(at, best))

		if best == at {
			return
		}
		hi, lo := a.Int(best), a.Int(at)
		tr.Group(func() {
			a.Set(at, hi)
			a.Set(best, lo)
		}).Note("%d outranks %d -- swap them", hi, lo)
		at = best
	}
}

// setIf skips a write that would not change anything.
//
// The alternative is a V11 warning on every sift that begins where the previous
// one ended, which is common: the build phase walks start backwards, and a
// subtree that is already a heap leaves the cursors exactly where the next
// start puts them. Ev's methods are nil-safe, so the caller still chains.
func setIf(s *tracer.Scalar, v int) *tracer.Ev {
	if s.Int() == v {
		return nil
	}
	return s.Set(v)
}

func pickNote(at, best int) string {
	if best == at {
		return "a[" + itoa(at) + "] already outranks both children"
	}
	return "a[" + itoa(best) + "] is the largest of the three"
}
