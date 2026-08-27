package graphs

import (
	_ "embed"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed prim.go
var primSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "prim",
		Title:  "Prim's Minimum Spanning Tree",
		Family: "Graphs",
		Blurb:  "Grow one tree outward, always taking the cheapest edge that reaches somewhere new.",
		Inputs: []algos.InputSpec{
			{Name: "n", Kind: "int", Min: 4, Max: 12, Default: 8,
				Help: "nodes; the edges and weights are generated deterministically"},
		},
		Defaults:   algos.Args{"n": 8},
		Source:     trace.Source{Path: "internal/algos/graphs/prim.go", Text: primSrc, FirstLine: 1},
		Tags:       []string{"graph", "greedy", "mst"},
		Complexity: "O(n)",
		Sweep:      []string{"n"},
		Run:        runPrim,
	})
}

// PRIM AND DIJKSTRA ARE THE SAME PROGRAM WITH ONE LINE CHANGED, and putting
// them side by side is the clearest evidence in the project that the renderer
// is doing no algorithm-specific work.
//
// Dijkstra keys the frontier on dist[u] + w -- the cost of the whole path back
// to the source. Prim keys it on w alone -- the cost of one edge crossing out
// of the tree. Everything else is identical, and so is the view: the same
// `distOf`, `settledOf`, `predOf`, `queueOf`, `cursorRef` and `probeOf`, naming
// different structures. GraphView was never told which of the two it is
// drawing, and there is nowhere it could find out.
//
// Run this and dijkstra over the same n and the graphs are identical, because
// build(n) is deterministic. The trees they produce are not, and the difference
// is worth looking at: a shortest-path tree minimises each node's distance from
// the source, a minimum spanning tree minimises the TOTAL, and neither is the
// other.
func runPrim(tr *tracer.Tracer, args algos.Args) error {
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
	// `key` is Dijkstra's `dist` with a different meaning: the cheapest single
	// edge that reaches this node from the tree, not the cheapest path from the
	// source. Same shape, same renderer, different algorithm.
	key := tr.Map("key", trace.Inf)
	inTree := tr.Map("in", false)
	pred := tr.Map("pred", nil)
	via := tr.Map("via", nil).Aux()
	q := newPQ(tr, "fringe", n)

	tr.View("graph", "g", 0,
		tracer.Title("graph"),
		tracer.Opt("distOf", "key"),
		tracer.Opt("settledOf", "in"),
		tracer.Opt("predOf", "pred"),
		tracer.Opt("queueOf", "fringe"),
		tracer.Opt("cursorRef", "u"),
		tracer.Opt("probeOf", "via"),
		tracer.StartHere(tr))
	tr.View("linear", "fringe", 1, tracer.Title("the fringe"))

	total := 0
	tr.Group(func() {
		key.Set(src, 0).Because("the tree starts here, so reaching it is free")
		q.push(src, 0)
	}).Note("start the tree at %s", src)

	var u string
	for q.len() > 0 {
		u = q.min()
		w := 0
		if kv, ok := trace.Num(key.At(u)); ok {
			w = int(kv)
		}
		total += w
		tr.Group(func() {
			g.Ref("u", u)
			inTree.Set(u, true)
			q.remove(u)
		}).Note("%s joins the tree on its cheapest edge", u)

		for _, v := range nb[u] {
			ew := weight(edges, u, v)
			cur := key.At(v)

			switch {
			case inTree.At(v) == true:
				look(tr, via, v, u).
					Note("%s is already in the tree -- this edge would close a loop", v)

			case isInf(cur) || ew < intOf(cur):
				// THE ONE LINE THAT DIFFERS FROM DIJKSTRA. There is no key[u] on
				// the right-hand side: how far u is from the source has nothing
				// to do with how expensive it is to reach v from u.
				look(tr, via, v, u).
					Because("the edge costs %d, better than %s", ew, showDist(cur))
				tr.Group(func() {
					key.Set(v, ew).
						Because("w(%s,%s) = %d", u, v, ew).
						From(g.EdgeCell(u, v, "w"))
					pred.Set(v, u)
					q.push(v, ew)
				}).Note("%s can now be reached for %d, through %s", v, ew, u)

			default:
				look(tr, via, v, u).
					Note("the edge costs %d, not better than %s -- skip", ew, showDist(cur))
			}
		}
	}

	g.Ref("u", "").
		Note("the fringe is empty -- the spanning tree is complete and costs %d", total)
	return tr.Err()
}
