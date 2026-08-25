package sorting

import (
	_ "embed"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed bubble.go
var bubbleSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "bubble",
		Title:  "Bubble Sort",
		Family: "Sorting",
		Blurb:  "Walk the array swapping neighbours. The largest value bubbles to the end each pass.",
		Inputs: []algos.InputSpec{
			{Name: "values", Kind: "intList", Max: 12, Default: []int{5, 2, 9, 1, 7, 3},
				Help: "up to 12 numbers"},
		},
		Defaults: algos.Args{"values": []int{5, 2, 9, 1, 7, 3}},
		Source:   trace.Source{Path: "internal/algos/sorting/bubble.go", Text: bubbleSrc, FirstLine: 1},
		Tags:     []string{"linear", "swap", "quadratic"},
		Run:      runBubble,
	})
}

// Two things to notice in the instrumentation:
//
//   - The swap is wrapped in tr.Group, so two writes advance the player ONE
//     step. Without that the array passes through a state where one value is
//     duplicated and the other is gone, and a viewer reads that as a bug in the
//     visualizer rather than as a half-finished swap.
//
//   - `i`, `j` and `sorted` are aux scalars at detail level 1: CURSOR
//     STRUCTURES. Bubble sort on nearly-sorted input performs O(n^2)
//     comparisons and almost no writes, so without them the trace would be
//     nearly empty. Promoting the scan position to a write is what makes the
//     algorithm visible. FLAWS.md 1.
func runBubble(tr *tracer.Tracer, args algos.Args) error {
	vals := args.Ints("values")
	n := len(vals)

	a := tr.Array("a", n, 0)
	a.Fill(vals)

	i := tr.Scalar("i", -1).Aux()
	j := tr.Scalar("j", -1).Aux()
	sorted := tr.Scalar("sorted", n).Aux()

	tr.View("linear", "a", 0,
		tracer.Title("array"),
		tracer.Opt("cursors", []any{"i", "j"}),
		tracer.Opt("regions", []any{
			map[string]any{"name": "sorted", "from": "sorted", "to": n, "style": "settled"},
		}))

	for pass := 0; pass < n-1; pass++ {
		i.Set(pass).Lvl(1).Because("pass %d", pass)
		swapped := false
		for k := 0; k < n-1-pass; k++ {
			j.Set(k).Lvl(1).Because("compare a[%d] and a[%d]", k, k+1)
			left, right := a.Int(k), a.Int(k+1)
			if left > right {
				tr.Group(func() {
					a.Set(k, right).Because("a[%d]", k+1).From(a.Cell(k + 1))
					a.Set(k+1, left).Because("a[%d]", k)
				}).Note("%d > %d, so swap them", left, right)
				swapped = true
			}
		}
		sorted.Set(n-1-pass).Lvl(1).
			Because("everything from index %d is now in place", n-1-pass)
		if !swapped {
			break
		}
	}
	sorted.Set(0).Lvl(1).Because("the whole array is sorted")
	i.Set(-1).Lvl(1)
	j.Set(-1).Lvl(1)
	return tr.Err()
}
