package graphs

import (
	_ "embed"
	"sort"
	"strconv"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed kruskal.go
var kruskalSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "kruskal",
		Title:  "Kruskal's Minimum Spanning Tree",
		Family: "Graphs",
		Blurb:  "Take the cheapest edge that joins two pieces, and reject every edge that would close a loop.",
		Inputs: []algos.InputSpec{
			{Name: "n", Kind: "int", Min: 4, Max: 12, Default: 8,
				Help: "nodes; the edges and weights are generated deterministically"},
		},
		Defaults: algos.Args{"n": 8},
		Source:   trace.Source{Path: "internal/algos/graphs/kruskal.go", Text: kruskalSrc, FirstLine: 1},
		Tags:     []string{"graph", "greedy", "union-find"},
		// One step per edge considered, and the swept family has E = 1.5V. The
		// sort that makes Kruskal O(m log m) happens before the first event, so it
		// is not traced and must not be claimed here.
		Complexity: "O(n)",
		Sweep:      []string{"n"},
		Run:        runKruskal,
	})
}

// KRUSKAL IS THE ALGORITHM WITH NO NODE CURSOR, and that turns out to matter to
// the renderer rather than to the algorithm.
//
// Dijkstra, BFS and DFS all stand somewhere and look at the neighbourhood, so
// focus-and-context has an obvious centre. Kruskal stands nowhere: it walks a
// sorted list of EDGES and asks one question about each. So this trace declares
// no `cursorRef`, the renderer finds no cursor, and it drops the dimming and
// shows every weight -- which is exactly right, because the weights ARE the
// list being walked.
//
// That behaviour is not a special case for Kruskal. It is what "no cursor"
// means, and any algorithm that declares no cursor gets it.
//
// The verdict on each edge is an edge ATTRIBUTE, `st`, and the renderer paints
// whatever string it finds there. Chosen edges go green, rejected ones go rose
// and dashed. Nothing in the renderer knows the words "spanning" or "cycle".
func runKruskal(tr *tracer.Tracer, args algos.Args) error {
	n := args.Int("n")
	edges := build(n)

	// Sorted by weight, ties broken by declaration order, because a sort that is
	// not total is a sort that gives different answers on different machines --
	// and a share link has to draw the same tree every time.
	idx := make([]int, len(edges))
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool {
		return weightOf(edges[idx[a]]) < weightOf(edges[idx[b]])
	})

	g := tr.Graph("g", trace.Schema{
		Nodes:      ids(n),
		Edges:      edges,
		Weighted:   true,
		LayoutHint: "force",
	})
	comp := tr.Map("comp", nil)
	inTree := tr.Map("in", false)
	sorted := tr.Array("sorted", len(edges), nil)
	at := tr.Scalar("at", -1).Aux()

	root := map[string]string{}
	tr.Group(func() {
		for k, e := range idx {
			sorted.Set(k, edges[e].U+"-"+edges[e].V+":"+strconv.Itoa(weightOf(edges[e])))
		}
		for _, id := range ids(n) {
			// Every node starts as its own component. Writing it rather than
			// leaving it implicit is what lets the sub-label show a merge.
			comp.Set(id, id)
			root[id] = id
		}
	}).Note("sort the edges and give every node its own component")

	// Declared after the construction group, so StartHere opens the player on the
	// first real decision rather than on the sort.
	//
	// NO cursorRef: see the comment at the top. The renderer takes its absence as
	// "this algorithm stands nowhere", drops the dimming and shows every weight.
	tr.View("graph", "g", 0,
		tracer.Title("graph"),
		tracer.Opt("distOf", "comp"),
		tracer.Opt("settledOf", "in"),
		tracer.Opt("edgeStateOf", "st"),
		tracer.Opt("edgeOrder", "weight"),
		tracer.StartHere(tr))
	tr.View("linear", "sorted", 1,
		tracer.Title("edges, cheapest first"),
		tracer.Opt("cursors", []any{"at"}))

	find := func(x string) string {
		for root[x] != x {
			x = root[x]
		}
		return x
	}

	chosen := 0
	for k, e := range idx {
		u, v := edges[e].U, edges[e].V
		w := weightOf(edges[e])
		ru, rv := find(u), find(v)

		if ru == rv {
			tr.Group(func() {
				at.Set(k)
				g.SetEdge(u, v, "st", "pruned").
					Because("%s and %s are already in component %s", u, v, ru).
					From(comp.Cell(u), comp.Cell(v))
			}).Note("%s-%s would close a loop -- reject it", u, v)
			continue
		}

		// Read before the writes, for the same reason dfs.go does: a Cell
		// snapshots its value, and taking it afterwards would cite the answer as
		// its own evidence.
		cu, cv := comp.Cell(u), comp.Cell(v)
		// Everything whose ROOT is ru, not everything whose parent is ru. Union-find
		// without path compression makes a chain, and the first version walked one
		// link -- so a three-deep component moved its head and orphaned the rest,
		// leaving nodes labelled with a root that no longer existed.
		moved := []string{}
		for _, id := range ids(n) {
			if find(id) == ru {
				moved = append(moved, id)
			}
		}
		root[ru] = rv

		tr.Group(func() {
			at.Set(k)
			g.SetEdge(u, v, "st", "settled").
				Because("%s is in %s and %s is in %s -- different components", u, ru, v, rv).
				From(cu, cv)
			// A node joins the tree on its FIRST chosen edge and stays. Writing
			// true over true would be check V11, and it would also claim a change
			// the picture does not make.
			for _, x := range []string{u, v} {
				if inTree.At(x) != true {
					inTree.Set(x, true)
				}
			}
			for _, id := range moved {
				if s, ok := comp.At(id).(string); !ok || s != rv {
					comp.Set(id, rv)
				}
			}
		}).Note("take %s-%s at cost %d -- the two components become one", u, v, w)
		chosen++

		// n-1 edges span n nodes, and every edge after that must close a loop.
		// Stopping here rather than scanning the tail is the difference between
		// a trace that ends on the answer and one that ends on eight rejections.
		if chosen == n-1 {
			break
		}
	}

	at.Set(-1).Note("%d edges chosen -- that spans all %d nodes", chosen, n)
	return tr.Err()
}

func weightOf(e trace.Edge) int {
	n, _ := trace.Num(e.W)
	return int(n)
}
