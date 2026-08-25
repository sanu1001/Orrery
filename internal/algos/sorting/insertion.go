package sorting

import (
	_ "embed"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed insertion.go
var insertionSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "insertion",
		Title:  "Insertion Sort",
		Family: "Sorting",
		Blurb:  "Grow a sorted prefix one element at a time, shifting the rest out of the way.",
		Inputs: []algos.InputSpec{
			{Name: "values", Kind: "intList", Max: 12, Default: []int{5, 2, 9, 1, 7, 3}},
		},
		Defaults: algos.Args{"values": []int{5, 2, 9, 1, 7, 3}},
		Source:   trace.Source{Path: "internal/algos/sorting/insertion.go", Text: insertionSrc, FirstLine: 1},
		Tags:     []string{"linear", "shift"},
		Run:      runInsertion,
	})
}

// Insertion sort is in the set because its write pattern is genuinely
// different from bubble sort's: it SHIFTS rather than swaps, so the same
// renderer has to make a run of single writes read as one movement. If the
// Linear renderer looks right for both, it is right.
func runInsertion(tr *tracer.Tracer, args algos.Args) error {
	vals := args.Ints("values")
	n := len(vals)

	a := tr.Array("a", n, 0)
	a.Fill(vals)

	i := tr.Scalar("i", -1).Aux()
	j := tr.Scalar("j", -1).Aux()
	key := tr.Scalar("key", 0).Aux()
	sortedTo := tr.Scalar("sortedTo", 1).Aux()

	tr.View("linear", "a", 0,
		tracer.Title("array"),
		tracer.Opt("cursors", []any{"i", "j"}),
		tracer.Opt("chips", []any{"key"}),
		tracer.Opt("regions", []any{
			map[string]any{"name": "sorted", "from": 0, "to": "sortedTo", "style": "settled"},
		}))

	for idx := 1; idx < n; idx++ {
		i.Set(idx).Lvl(1).Because("take a[%d] and find its home", idx)
		k := a.Int(idx)
		key.Set(k).Lvl(1).Because("a[%d]", idx).From(a.Cell(idx))

		p := idx - 1
		for p >= 0 && a.Int(p) > k {
			j.Set(p).Lvl(1)
			a.Set(p+1, a.Int(p)).
				Because("a[%d]", p).
				From(a.Cell(p)).
				Note("%d > %d, so shift it right", a.Int(p), k)
			p--
		}
		if p+1 != idx {
			a.Set(p+1, k).Because("key").Note("drop %d into the gap at index %d", k, p+1)
		}
		sortedTo.Set(idx+1).Lvl(1).Because("the first %d elements are sorted", idx+1)
	}
	i.Set(-1).Lvl(1)
	j.Set(-1).Lvl(1)
	return tr.Err()
}
