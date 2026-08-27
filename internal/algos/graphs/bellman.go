package graphs

import (
	_ "embed"
	"strconv"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed bellman.go
var bellmanSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "bellman-ford",
		Title:  "Bellman-Ford",
		Family: "Graphs",
		Blurb:  "Relax every edge, over and over, until nothing improves. Slower than Dijkstra, and it survives negative weights.",
		Inputs: []algos.InputSpec{
			{Name: "n", Kind: "int", Min: 4, Max: 10, Default: 7,
				Help: "nodes; some edge weights are negative"},
		},
		Defaults:   algos.Args{"n": 7},
		Source:     trace.Source{Path: "internal/algos/graphs/bellman.go", Text: bellmanSrc, FirstLine: 1},
		Tags:       []string{"graph", "shortest-path", "negative-weights"},
		Complexity: "O(n^2)",
		Sweep:      []string{"n"},
		Run:        runBellman,
	})
}

// THE REASON TO SHOW THIS BESIDE DIJKSTRA IS THE NEGATIVE EDGE.
//
// Dijkstra settles a node the moment it comes off the queue and never looks at
// it again, and that is only sound when every edge is non-negative -- a later
// path cannot become cheaper by travelling further. Give it a negative edge and
// it returns a confident wrong answer. Bellman-Ford makes no such assumption:
// it relaxes EVERY edge, repeatedly, until a whole pass changes nothing.
//
// So the picture is different in a way that is worth watching. There is no
// frontier and no settled set -- `settledOf` names nothing, and every node stays
// improvable until the algorithm stops. What moves instead is the edge cursor
// in the second pane, walking the same list over and over while the distances
// underneath it slowly stop changing.
//
// The graph is a DAG with negative weights on some edges. Acyclic by
// construction, so there is no negative cycle to detect -- and the check for one
// still runs at the end, because "no cycle got shorter on the extra pass" is the
// output of the algorithm rather than an assumption about its input.
func runBellman(tr *tracer.Tracer, args algos.Args) error {
	n := args.Int("n")
	edges := negativeDAG(n)
	src := id(0)

	g := tr.Graph("g", trace.Schema{
		Nodes:      ids(n),
		Edges:      edges,
		Directed:   true,
		Weighted:   true,
		Refs:       []string{"u", "v"},
		LayoutHint: "layered",
	})
	dist := tr.Map("dist", trace.Inf)
	pred := tr.Map("pred", nil)
	list := tr.Array("edges", len(edges), nil)
	at := tr.Scalar("at", -1).Aux()
	round := tr.Scalar("round", 0)

	tr.Group(func() {
		for i, e := range edges {
			list.Set(i, e.U+"→"+e.V+":"+strconv.Itoa(weightOf(e)))
		}
	}).Note("the edge list, relaxed in this order every pass")

	// NO settledOf AND NO queueOf. Bellman-Ford has neither, and declaring one
	// that does not exist would draw a claim the algorithm never makes -- every
	// node would read as "in the frontier" for the whole run.
	tr.View("graph", "g", 0,
		tracer.Title("graph"),
		tracer.Opt("distOf", "dist"),
		tracer.Opt("predOf", "pred"),
		tracer.Opt("cursorRef", "u"),
		tracer.Opt("probeRef", "v"),
		tracer.StartHere(tr))
	tr.View("linear", "edges", 1,
		tracer.Title("every edge, every pass"),
		tracer.Opt("cursors", []any{"at"}),
		tracer.Opt("chips", []any{"round"}))

	dist.Set(src, 0).Because("the source is zero from itself")

	// n-1 passes is the BOUND, not the count: a shortest path visits at most n
	// nodes, so it has at most n-1 edges, and one pass fixes at least one more
	// edge of it. Stopping early when a pass changes nothing is what turns that
	// worst case into the usual case.
	for pass := 1; pass < n; pass++ {
		changed := false
		round.Set(pass).Note("pass %d of at most %d", pass, n-1)

		for i, e := range edges {
			du := dist.At(e.U)
			w := weightOf(e)
			// An edge out of a node nothing has reached yet says nothing. Skipping
			// it silently rather than as a step keeps the pass readable: on the
			// first pass most of the list is exactly this.
			if isInf(du) {
				continue
			}
			alt := intOf(du) + w
			cur := dist.At(e.V)

			tr.Group(func() {
				at.Set(i)
				gref(tr, g, "u", e.U)
				gref(tr, g, "v", e.V)
			}).Note("edge %s to %s, cost %d", e.U, e.V, w)

			if isInf(cur) || alt < intOf(cur) {
				tr.Group(func() {
					dist.Set(e.V, alt).
						Because("dist[%s] + w(%s,%s) = %d + %d", e.U, e.U, e.V, intOf(du), w).
						From(dist.Cell(e.U), g.EdgeCell(e.U, e.V, "w"))
					pred.Set(e.V, e.U)
				}).Note("%s improves to %d", e.V, alt)
				changed = true
			}
		}

		if !changed {
			// A PASS THAT CHANGES NOTHING PROVES THE ANSWER. Nothing later can
			// change either, because the next pass would read the same distances
			// and reach the same conclusions -- so this is the algorithm's own
			// termination proof, not an optimisation bolted on.
			tr.Group(func() {
				at.Set(-1)
				gref(tr, g, "u", "")
				gref(tr, g, "v", "")
			}).Note("pass %d improved nothing, so nothing later can -- done", pass)
			return tr.Err()
		}
	}

	// The extra pass. Anything that still improves is on a cycle whose weights
	// sum to less than zero, and such a graph has no shortest path at all: go
	// round again and the total drops further.
	negative := ""
	for _, e := range edges {
		du := dist.At(e.U)
		if isInf(du) {
			continue
		}
		if alt := intOf(du) + weightOf(e); !isInf(dist.At(e.V)) && alt < intOf(dist.At(e.V)) {
			negative = e.U + "→" + e.V
			break
		}
	}
	tr.Group(func() {
		at.Set(-1)
		gref(tr, g, "u", "")
		gref(tr, g, "v", "")
	}).Note("%s", bellmanEnd(negative))
	return tr.Err()
}

func bellmanEnd(negative string) string {
	if negative == "" {
		return "one more pass improves nothing: there is no negative cycle, and these are the answers"
	}
	return negative + " still improves on the extra pass -- there is a negative cycle, and no shortest path exists"
}

// negativeDAG is a DAG with some negative weights: every edge runs from a lower
// index to a higher one, so there is no cycle at all and therefore no negative
// one.
//
// The edge ORDER is reversed before it is returned, and that is deliberate. In
// declaration order a DAG converges in a single pass and the remaining passes
// find nothing, which makes the algorithm look pointless. Reversed, the
// improvement has to travel one edge per pass, which is exactly the behaviour
// the n-1 bound exists for.
func negativeDAG(n int) []trace.Edge {
	var r rng = 7919
	out := make([]trace.Edge, 0, n+n/2)
	for i := 1; i < n; i++ {
		// Weights in -4..5. Negative often enough to matter, and the sum along
		// any path stays small enough to read.
		out = append(out, trace.Edge{U: id(r.next(i)), V: id(i), W: r.next(10) - 4})
	}
	for k := 0; k < n/2; k++ {
		u, v := r.next(n), r.next(n)
		if u >= v || hasEdge(out, id(u), id(v)) {
			continue
		}
		out = append(out, trace.Edge{U: id(u), V: id(v), W: r.next(10) - 4})
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}
