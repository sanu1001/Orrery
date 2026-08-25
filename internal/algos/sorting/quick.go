package sorting

import (
	_ "embed"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed quick.go
var quickSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "quick",
		Title:  "Quicksort",
		Family: "Sorting",
		Blurb:  "Partition around a pivot, then recurse. The call stack is half the story.",
		Inputs: []algos.InputSpec{
			{Name: "values", Kind: "intList", Max: 12, Default: []int{5, 2, 9, 1, 7, 3, 8}},
		},
		Defaults: algos.Args{"values": []int{5, 2, 9, 1, 7, 3, 8}},
		Source:   trace.Source{Path: "internal/algos/sorting/quick.go", Text: quickSrc, FirstLine: 1},
		Tags:     []string{"linear", "recursion", "divide-and-conquer"},
		Run:      runQuick,
	})
}

// Quicksort earns its place by being the only Tier 1 algorithm where recursion
// operates on a SHARED array: the call stack and the linear view have to be
// read together. It is also the cheapest test that two panes of different
// families compose.
func runQuick(tr *tracer.Tracer, args algos.Args) error {
	vals := args.Ints("values")
	n := len(vals)

	a := tr.Array("a", n, 0)
	a.Fill(vals)

	pivot := tr.Scalar("pivot", 0).Aux()
	lo := tr.Scalar("lo", 0).Aux()
	hi := tr.Scalar("hi", n-1).Aux()

	tr.View("linear", "a", 0,
		tracer.Title("array"),
		tracer.Opt("cursors", []any{"lo", "hi"}),
		tracer.Opt("chips", []any{"pivot"}))
	tr.View("callStack", "$calls", "side")

	qs := &quickState{tr: tr, a: a, pivot: pivot, lo: lo, hi: hi}
	qs.sort(0, n-1)
	return tr.Err()
}

type quickState struct {
	tr            *tracer.Tracer
	a             *tracer.Array
	pivot, lo, hi *tracer.Scalar
}

func (q *quickState) sort(lo, hi int) {
	q.tr.Call("quicksort", tracer.A("lo", lo), tracer.A("hi", hi))
	if lo >= hi {
		q.tr.Return(nil).Because("a run of %d element(s) is already sorted", hi-lo+1)
		return
	}
	q.lo.Set(lo).Lvl(1)
	q.hi.Set(hi).Lvl(1)

	p := q.partition(lo, hi)
	q.sort(lo, p-1)
	q.sort(p+1, hi)
	q.tr.Return(nil).Because("both halves are sorted")
}

func (q *quickState) partition(lo, hi int) int {
	pv := q.a.Int(hi)
	q.pivot.Set(pv).Lvl(1).Because("a[%d]", hi).From(q.a.Cell(hi))

	i := lo
	for j := lo; j < hi; j++ {
		if q.a.Int(j) < pv {
			if i != j {
				vi, vj := q.a.Int(i), q.a.Int(j)
				q.tr.Group(func() {
					q.a.Set(i, vj).Because("a[%d]", j).From(q.a.Cell(j))
					q.a.Set(j, vi).Because("a[%d]", i)
				}).Note("%d < pivot %d, move it left", vj, pv)
			}
			i++
		}
	}
	if i != hi {
		vi, vh := q.a.Int(i), q.a.Int(hi)
		q.tr.Group(func() {
			q.a.Set(i, vh).Because("pivot")
			q.a.Set(hi, vi).Because("a[%d]", i)
		}).Note("put the pivot %d in its final place at index %d", pv, i)
	}
	return i
}
