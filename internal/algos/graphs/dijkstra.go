package graphs

import (
	_ "embed"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed dijkstra.go
var dijkstraSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "dijkstra",
		Title:  "Dijkstra's Shortest Paths",
		Family: "Graphs",
		Blurb:  "Settle the nearest unsettled node, then relax every edge leaving it.",
		Inputs: []algos.InputSpec{
			{Name: "n", Kind: "int", Min: 4, Max: 12, Default: 8,
				Help: "nodes; the edges and weights are generated deterministically"},
		},
		Defaults: algos.Args{"n": 8},
		Source:   trace.Source{Path: "internal/algos/graphs/dijkstra.go", Text: dijkstraSrc, FirstLine: 1},
		Tags:     []string{"graph", "greedy", "shortest-path"},
		// O(n^2) IS THE CLAIM, and the measured curve will disagree with it. That
		// disagreement is the honest one: the quadratic cost of this implementation
		// is the linear SCAN for the minimum, which is comparisons, and comparisons
		// only become steps at detail level 1. At level 0 the trace records writes,
		// and there are O(V + E) of those. The gap between the two is the whole
		// reason a real implementation reaches for a heap.
		Complexity: "O(n^2)",
		Sweep:      []string{"n"},
		Run:        runDijkstra,
	})
}

// DIJKSTRA IS THE ALGORITHM THE GRAPH RENDERER WAS DESIGNED AROUND, and the
// reason is the failed relaxation.
//
// A successful relaxation writes `dist`, so it is a step for free. A FAILED one
// writes nothing at all -- the algorithm computes a candidate, finds it no
// better, and moves on -- so under "one step is one write" the most instructive
// half of the run is invisible. What makes it visible is `via`, an aux map that
// exists purely to promote the read to a write: it records WHICH NODE each
// examination is coming from, whether or not the candidate wins.
//
// That is the cursor-structure mechanism at its clearest (ARCHITECTURE.md 6.1),
// and it is why `via` writes are level 1: at level 0 you watch the answer being
// built, at level 1 you watch every candidate that was considered and rejected.
// Same trace, one filter. See look() in graph.go for why the value is the source
// node rather than the candidate distance.
//
// Nothing here tells the renderer it is drawing Dijkstra. The view options name
// the structures -- which map holds the distances, which holds the settled set,
// which array is the frontier -- and the renderer reads them. Swap the options
// and the same renderer draws Prim's algorithm. That is invariant I2 being
// cashed in rather than merely stated.
func runDijkstra(tr *tracer.Tracer, args algos.Args) error {
	n := args.Int("n")
	edges := build(n)
	nb := adj(edges, false)
	src := id(0)

	g := tr.Graph("g", trace.Schema{
		Nodes:      ids(n),
		Edges:      edges,
		Weighted:   true,
		Refs:       []string{"u"},
		LayoutHint: "force",
	})
	dist := tr.Map("dist", trace.Inf)
	done := tr.Map("done", false)
	// `pred` is not decoration: it is the shortest-path TREE, and it is what
	// turns a screen full of numbers into a picture of the answer. One write per
	// successful relaxation, and the renderer draws the edges it names.
	pred := tr.Map("pred", nil)
	via := tr.Map("via", nil).Aux()
	q := newPQ(tr, "pq", n)

	tr.View("graph", "g", 0,
		tracer.Title("graph"),
		tracer.Opt("distOf", "dist"),
		tracer.Opt("settledOf", "done"),
		tracer.Opt("predOf", "pred"),
		tracer.Opt("queueOf", "pq"),
		tracer.Opt("cursorRef", "u"),
		tracer.Opt("probeOf", "via"),
		tracer.StartHere(tr))
	tr.View("linear", "pq", 1, tracer.Title("priority queue"))

	tr.Group(func() {
		dist.Set(src, 0).Because("the source is zero from itself")
		q.push(src, 0)
	}).Note("start at %s", src)

	var u string
	for q.len() > 0 {
		u = q.min()
		tr.Group(func() {
			// The ref move goes FIRST so the step carries its source line: the
			// queue writes originate in graph.go and have none.
			g.Ref("u", u)
			done.Set(u, true)
			q.remove(u)
		}).Note("%s is the nearest unsettled node -- settle it", u)

		du, _ := trace.Num(dist.At(u))

		for _, v := range nb[u] {
			w := weight(edges, u, v)
			alt := int(du) + w
			cur := dist.At(v)

			switch {
			case done.At(v) == true:
				look(tr, via, v, u).
					Note("%s is already settled -- nothing left to improve", v)

			case isInf(cur) || alt < intOf(cur):
				// Because, not Note, and the difference is load-bearing: the
				// renderer reads `expr` as "this candidate was accepted" and a bare
				// `note` as "rejected". Nothing graph-specific -- it is the same
				// split the explanation pane already makes.
				look(tr, via, v, u).
					Because("%d + %d = %d, better than %s", int(du), w, alt, showDist(cur))
				tr.Group(func() {
					// The Because is what the renderer paints ON the edge. It comes
					// out of the algorithm, not out of a template in the frontend --
					// which is the whole reason the explanations can be trusted.
					dist.Set(v, alt).
						Because("dist[%s] + w(%s,%s) = %d + %d", u, u, v, int(du), w).
						From(dist.Cell(u), g.EdgeCell(u, v, "w"))
					pred.Set(v, u)
					q.push(v, alt)
				}).Note("%s is now %d away, through %s", v, alt, u)

			default:
				look(tr, via, v, u).
					Note("%d + %d = %d, not better than %s -- skip", int(du), w, alt, showDist(cur))
			}
		}
	}

	g.Ref("u", "").
		Note("the queue is empty -- every reachable node has its shortest distance")
	return tr.Err()
}

// THE RULE THAT SEEK-EQUIVALENCE ENFORCES, recorded here because breaking it
// cost the first run of this file: a LEVEL-0 write may never read back a value
// that only a level-1 write produced.
//
// The first version parked a probe cursor inside the pop group, at level 0, and
// its `from` was the last node examined -- a value level-0 replay had never
// seen. Forward it looked fine; rewinding through it restored a value out of
// thin air. TestSeekEquivalence caught it immediately. `cand` is written at
// level 1 and nowhere else, which is what makes it sound. ADR 0016.

// isInf reports whether a distance is still the sentinel. JSON has no Infinity,
// so it travels as the string "inf" -- trace.Inf, and comparing against the
// literal here would be the kind of duplication that survives a rename.
func isInf(v trace.Value) bool {
	s, ok := v.(string)
	return ok && s == trace.Inf
}

func intOf(v trace.Value) int {
	n, _ := trace.Num(v)
	return int(n)
}

// showDist spells infinity out rather than using the glyph. This text reaches
// the live region as speech (C11), and a screen reader reads the glyph as
// nothing at all.
func showDist(v trace.Value) string {
	if isInf(v) {
		return "infinity"
	}
	return trace.Canon(v)
}
