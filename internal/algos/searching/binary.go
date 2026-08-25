package searching

import (
	_ "embed"
	"sort"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed binary.go
var binarySrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "binary",
		Title:  "Binary Search",
		Family: "Searching",
		Blurb:  "Halve the range until the target is cornered.",
		Inputs: []algos.InputSpec{
			{Name: "values", Kind: "intList", Max: 16,
				Default: []int{2, 5, 8, 13, 21, 34, 55, 89},
				Help:    "sorted automatically"},
			{Name: "target", Kind: "int", Min: -999, Max: 999, Default: 21},
		},
		Defaults: algos.Args{"values": []int{2, 5, 8, 13, 21, 34, 55, 89}, "target": 21},
		Source:   trace.Source{Path: "internal/algos/searching/binary.go", Text: binarySrc, FirstLine: 1},
		Tags:     []string{"linear", "cursors", "logarithmic"},
		Run:      runBinary,
	})
}

// BINARY SEARCH IS THE CASE THAT BREAKS THE NAIVE GRANULARITY RULE, and it is
// in the Tier 1 set precisely for that reason.
//
// On eight elements it performs three comparisons and ZERO writes to the array.
// Under "one step = one write" its trace would be empty and the algorithm would
// be invisible. Every step you see below is a write to lo / mid / hi -- aux
// CURSOR STRUCTURES that exist only to make a read observable.
//
// The cost is honest and worth stating: nothing detects a missing cursor. An
// algorithm instrumented without them produces a valid, well-formed, useless
// trace. See FLAWS.md 1.
func runBinary(tr *tracer.Tracer, args algos.Args) error {
	vals := append([]int(nil), args.Ints("values")...)
	sort.Ints(vals)
	target := args.Int("target")
	n := len(vals)

	a := tr.Array("a", n, 0)
	a.Fill(vals)

	lo := tr.Scalar("lo", 0).Aux()
	hi := tr.Scalar("hi", n-1).Aux()
	mid := tr.Scalar("mid", -1).Aux()
	found := tr.Scalar("found", -1).Aux()

	tr.View("linear", "a", 0,
		tracer.Title("sorted array"),
		tracer.Opt("cursors", []any{"lo", "mid", "hi"}),
		tracer.Opt("regions", []any{
			map[string]any{"name": "live", "from": "lo", "to": "hi", "style": "cursor"},
		}))

	// NOTE: these cursor writes are level 0, not level 1 -- unlike bubble sort's
	// scan pointers, which are level 1. The difference is the whole judgement
	// call: in bubble sort the swaps are the algorithm and the pointers are
	// detail, so hiding them still leaves something to watch. Here there are NO
	// writes to the array at all, so filtering the cursors would leave an empty
	// trace. Same mechanism, opposite call.
	l, h := 0, n-1
	for l <= h {
		m := (l + h) / 2
		mid.Set(m).
			Because("(lo + hi) / 2 = (%d + %d) / 2", l, h).
			From(lo.Cell(), hi.Cell())

		v := a.Int(m)
		switch {
		case v == target:
			found.Set(m).
				Because("a[%d] == %d", m, target).
				From(a.Cell(m)).
				Note("found %d at index %d", target, m)
			return tr.Err()
		case v < target:
			l = m + 1
			lo.Set(l).
				Because("a[%d] = %d < %d, so discard everything left of %d", m, v, target, l).
				From(a.Cell(m))
		default:
			h = m - 1
			hi.Set(h).
				Because("a[%d] = %d > %d, so discard everything right of %d", m, v, target, h).
				From(a.Cell(m))
		}
	}
	found.Set(-1).Note("%d is not in the array -- lo passed hi", target)
	return tr.Err()
}
