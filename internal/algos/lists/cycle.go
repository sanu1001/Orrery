package lists

import (
	_ "embed"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed cycle.go
var cycleSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "list-cycle",
		Title:  "Floyd's Cycle Detection",
		Family: "Linked lists",
		Blurb:  "One pointer walks, one runs. If the list loops, the fast one laps the slow one.",
		Inputs: []algos.InputSpec{
			{Name: "values", Kind: "intList", Max: 20, Default: []int{3, 2, 0, -4, 9, 5},
				Help: "up to 20 values"},
			{Name: "loopTo", Kind: "int", Min: -1, Max: 19, Default: 1,
				Help: "index the tail links back to, or -1 for no cycle"},
		},
		Defaults: algos.Args{"values": []int{3, 2, 0, -4, 9, 5}, "loopTo": 1},
		Source:   trace.Source{Path: "internal/algos/lists/cycle.go", Text: cycleSrc, FirstLine: 1},
		Tags:     []string{"list", "two-pointer", "cycle"},
		Run:      runCycle,
	})
}

// The algorithm the linked-list renderer exists for, and it exercises the whole
// family: two refs moving at different speeds, a back edge that is the answer
// rather than an error, and a meeting point.
//
// Both pointer moves go in ONE group, so a step advances slow by one and fast
// by two together. Ungrouped, the eye reads three separate half-moves and the
// invariant that makes Floyd work -- fast gains exactly one node per step -- is
// no longer visible in the picture.
//
// Nothing here is special-cased in the renderer. The chips, the grouping and
// the back edge are all shared mechanism; the renderer never learns that this
// trace is about cycles.
func runCycle(tr *tracer.Tracer, args algos.Args) error {
	vals := args.Ints("values")
	loopTo := args.Int("loopTo")

	// `met` marks the meeting point. It is an ordinary scalar field, and the view
	// declares which field means "settled" -- data in the trace, never a renderer
	// that knows what Floyd's algorithm is (I2, ADR 0012).
	sch := singly("head", "slow", "fast")
	sch.Fields["met"] = trace.FScalar
	l := tr.Nodes("list", sch)
	head := build(tr, l, vals, false)
	if head != "" {
		l.Ref("head", head)
	}

	// The cycle is part of the INPUT, so it belongs in the prologue with the
	// rest of the construction rather than appearing mid-run as if the
	// algorithm had created it.
	if loopTo >= 0 && loopTo < len(vals) && len(vals) > 0 {
		l.Link(nodeID(len(vals)-1), "next", nodeID(loopTo)).
			Note("the tail links back to %d", vals[loopTo])
	}

	tr.View("linkedList", "list", 0, tracer.Title("list"),
		tracer.Opt("settled", "met"), tracer.StartHere(tr))
	if head == "" {
		return tr.Err()
	}

	slow, fast := head, head
	l.Ref("slow", slow)
	l.Ref("fast", fast)

	for {
		f1 := l.Ptr(fast, "next")
		if f1 == "" {
			l.Ref("fast", "").Note("fast ran off the end, so there is no cycle")
			return tr.Err()
		}
		f2 := l.Ptr(f1, "next")
		if f2 == "" {
			l.Ref("fast", "").Note("fast ran off the end, so there is no cycle")
			return tr.Err()
		}
		next := l.Ptr(slow, "next")

		tr.Group(func() {
			l.Ref("slow", next)
			l.Ref("fast", f2)
		}).Note("slow moves one to %d, fast moves two to %d", val(l, next), val(l, f2))

		slow, fast = next, f2
		if slow == fast {
			// Marked on the node itself rather than only in the prose, so the
			// answer is somewhere you can point at in the picture.
			l.SetField(slow, "met", true).
				Because("slow and fast are both at %d, so the list loops", val(l, slow))
			return tr.Err()
		}
	}
}
