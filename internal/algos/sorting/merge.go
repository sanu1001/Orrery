package sorting

import (
	_ "embed"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed merge.go
var mergeSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "merge",
		Title:  "Merge Sort",
		Family: "Sorting",
		Blurb:  "Split until the pieces are trivial, then merge them back in order.",
		Inputs: []algos.InputSpec{
			{Name: "values", Kind: "intList", Max: 32, Default: []int{5, 2, 9, 1, 7, 3, 8, 4}},
		},
		Defaults:   algos.Args{"values": []int{5, 2, 9, 1, 7, 3, 8, 4}},
		Source:     trace.Source{Path: "internal/algos/sorting/merge.go", Text: mergeSrc, FirstLine: 1},
		Tags:       []string{"linear", "recursion", "two-pane"},
		Complexity: "O(n log n)",
		Sweep:      []string{"values"},
		Run:        runMerge,
	})
}

// Merge sort is the two-structure warm-up for the flagship: `a` and `aux` are
// two separate structures that must be read together, in two panes, with
// aligned indices. If this composes, tree+grid will too.
func runMerge(tr *tracer.Tracer, args algos.Args) error {
	vals := args.Ints("values")
	n := len(vals)

	a := tr.Array("a", n, 0)
	a.Fill(vals)
	aux := tr.Array("aux", n, 0)

	lo := tr.Scalar("lo", 0).Aux()
	mid := tr.Scalar("mid", 0).Aux()
	hi := tr.Scalar("hi", n-1).Aux()

	tr.View("linear", "a", 0,
		tracer.Title("array"), tracer.Opt("cursors", []any{"lo", "mid", "hi"}))
	tr.View("linear", "aux", 1, tracer.Title("scratch"))
	tr.View("callStack", "$calls", "side")

	m := &mergeState{tr: tr, a: a, aux: aux, lo: lo, mid: mid, hi: hi}
	m.sort(0, n-1)
	return tr.Err()
}

type mergeState struct {
	tr          *tracer.Tracer
	a, aux      *tracer.Array
	lo, mid, hi *tracer.Scalar
}

func (m *mergeState) sort(lo, hi int) {
	m.tr.Call("mergesort", tracer.A("lo", lo), tracer.A("hi", hi))
	if lo >= hi {
		m.tr.Return(nil).Because("a single element is already sorted")
		return
	}
	md := (lo + hi) / 2
	m.lo.Set(lo).Lvl(1)
	m.mid.Set(md).Lvl(1)
	m.hi.Set(hi).Lvl(1)

	m.sort(lo, md)
	m.sort(md+1, hi)
	m.merge(lo, md, hi)
	m.tr.Return(nil).Because("merged [%d..%d] and [%d..%d]", lo, md, md+1, hi)
}

func (m *mergeState) merge(lo, md, hi int) {
	i, j := lo, md+1
	for k := lo; k <= hi; k++ {
		switch {
		case i > md:
			m.aux.Set(k, m.a.Int(j)).Because("a[%d]", j).From(m.a.Cell(j)).
				Note("the left half is exhausted")
			j++
		case j > hi:
			m.aux.Set(k, m.a.Int(i)).Because("a[%d]", i).From(m.a.Cell(i)).
				Note("the right half is exhausted")
			i++
		case m.a.Int(i) <= m.a.Int(j):
			m.aux.Set(k, m.a.Int(i)).Because("a[%d]", i).
				From(m.a.Cell(i), m.a.Cell(j)).
				Note("%d <= %d, take from the left", m.a.Int(i), m.a.Int(j))
			i++
		default:
			m.aux.Set(k, m.a.Int(j)).Because("a[%d]", j).
				From(m.a.Cell(i), m.a.Cell(j)).
				Note("%d < %d, take from the right", m.a.Int(j), m.a.Int(i))
			j++
		}
	}
	m.tr.Group(func() {
		for k := lo; k <= hi; k++ {
			if m.a.Int(k) != m.aux.Int(k) {
				m.a.Set(k, m.aux.Int(k)).Because("aux[%d]", k).From(m.aux.Cell(k))
			}
		}
	}).Note("copy the merged run back into a[%d..%d]", lo, hi)
}
