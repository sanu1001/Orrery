package graphs

import (
	_ "embed"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed bfs.go
var bfsSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "bfs-maze",
		Title:  "Breadth-First Search (maze)",
		Family: "Graphs",
		Blurb:  "The frontier spreads one layer at a time, and every layer is one step further from the start.",
		Inputs: []algos.InputSpec{
			{Name: "n", Kind: "int", Min: 3, Max: 6, Default: 5,
				Help: "the maze is n by n; walls are placed deterministically"},
		},
		Defaults:   algos.Args{"n": 5},
		Source:     trace.Source{Path: "internal/algos/graphs/bfs.go", Text: bfsSrc, FirstLine: 1},
		Tags:       []string{"graph", "traversal", "grid"},
		Complexity: "O(n^2)",
		Sweep:      []string{"n"},
		Run:        runBFS,
	})
}

// THE LAYOUT IS THE LESSON HERE, and it is a lesson about provenance.
//
// This graph came from a lattice, so its nodes are named "2,3" and the trace
// declares layoutHint "grid". The renderer reads the coordinates back out of
// the ids and draws the maze as the maze. Run the identical algorithm over the
// identical trace with the hint set to "force" and you get a blob: correct,
// deterministic, and destroying the one piece of structure the viewer already
// understood before the algorithm started. RENDERERS/GRAPH.md 1.
//
// The second thing worth watching is `distAs: "layer"`. BFS with unit weights
// IS Dijkstra, so the frontier is a priority queue keyed by distance and the
// code below is very nearly the code in dijkstra.go. What changes is one view
// option: tinting by distance rather than by set membership turns "a frontier
// moving" into "the layers of the graph", which is the thing BFS actually
// computes. One option value, no renderer change.
func runBFS(tr *tracer.Tracer, args algos.Args) error {
	n := args.Int("n")
	nodes, edges := grid(n, n)
	nb := adj(edges, false)
	src := cell(0, 0)

	g := tr.Graph("g", trace.Schema{
		Nodes:      nodes,
		Edges:      edges,
		Refs:       []string{"u"},
		LayoutHint: "grid",
	})
	dist := tr.Map("dist", trace.Inf)
	done := tr.Map("done", false)
	pred := tr.Map("pred", nil)
	via := tr.Map("via", nil).Aux()
	q := newPQ(tr, "frontier", len(nodes))

	tr.View("graph", "g", 0,
		tracer.Title("maze"),
		tracer.Opt("distOf", "dist"),
		tracer.Opt("settledOf", "done"),
		tracer.Opt("predOf", "pred"),
		tracer.Opt("queueOf", "frontier"),
		tracer.Opt("cursorRef", "u"),
		tracer.Opt("probeOf", "via"),
		tracer.Opt("distAs", "layer"),
		tracer.StartHere(tr))
	tr.View("linear", "frontier", 1, tracer.Title("frontier"))

	tr.Group(func() {
		dist.Set(src, 0).Because("the start is zero steps from itself")
		q.push(src, 0)
	}).Note("start at the top-left corner")

	var u string
	for q.len() > 0 {
		u = q.min()
		tr.Group(func() {
			g.Ref("u", u)
			done.Set(u, true)
			q.remove(u)
		}).Note("%s is the nearest cell still on the frontier", u)

		du, _ := trace.Num(dist.At(u))
		layer := int(du) + 1

		for _, v := range nb[u] {
			switch {
			case done.At(v) == true:
				look(tr, via, v, u).
					Note("%s is already reached -- a second route cannot be shorter", v)

			case isInf(dist.At(v)):
				look(tr, via, v, u).
					Because("%d + 1 = %d, and %s has never been reached", int(du), layer, v)
				tr.Group(func() {
					dist.Set(v, layer).
						Because("dist[%s] + 1 = %d + 1", u, int(du)).
						From(dist.Cell(u))
					pred.Set(v, u)
					q.push(v, layer)
				}).Note("%s joins layer %d", v, layer)

			default:
				// UNIT WEIGHTS ARE WHY THIS BRANCH NEVER IMPROVES ANYTHING. A cell
				// already on the frontier was reached from a layer no deeper than
				// this one, so its distance is already minimal -- which is the
				// property that lets BFS settle a node the first time it is seen
				// and never revisit it.
				look(tr, via, v, u).
					Note("%s is already on the frontier at %s -- every route here costs the same",
						v, showDist(dist.At(v)))
			}
		}
	}

	g.Ref("u", "").
		Note("the frontier is empty -- every reachable cell has its layer")
	return tr.Err()
}
