package graphs

import (
	_ "embed"
	"strconv"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed toposort.go
var toposortSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "toposort",
		Title:  "Topological Sort",
		Family: "Graphs",
		Blurb:  "Emit anything nothing is waiting on, then cross it off everyone else's list.",
		Inputs: []algos.InputSpec{
			{Name: "n", Kind: "int", Min: 4, Max: 12, Default: 8,
				Help: "tasks; the dependencies are generated deterministically"},
		},
		Defaults: algos.Args{"n": 8},
		Source:   trace.Source{Path: "internal/algos/graphs/toposort.go", Text: toposortSrc, FirstLine: 1},
		Tags:     []string{"graph", "dag", "ordering"},
		// Kahn is O(V + E): one step per emit and one per in-degree decrement.
		Complexity: "O(n)",
		Sweep:      []string{"n"},
		Run:        runTopo,
	})
}

// THE LAYOUT IS THE ANSWER HERE, and that is the strongest case in the project
// for choosing layout by provenance.
//
// This graph is a DAG, the trace says so with layoutHint "layered", and the
// renderer puts every node at its longest-path depth. So before a single step
// runs, the picture already shows the dependency levels -- and the algorithm is
// then visibly reading them off top to bottom. A force layout over the same
// trace would scatter the same nodes into a cloud and the run would look
// arbitrary.
//
// Kahn's algorithm rather than a DFS post-order, because Kahn's state is DATA:
// a remaining in-degree per node, which is a number that counts down under each
// circle until it hits zero and the node is emitted. The DFS version keeps its
// state in the call stack and the recursion, where a `distOf` sub-label cannot
// reach it.
func runTopo(tr *tracer.Tracer, args algos.Args) error {
	n := args.Int("n")
	edges := dag(n)
	out := adj(edges, true)

	g := tr.Graph("g", trace.Schema{
		Nodes:      ids(n),
		Edges:      edges,
		Directed:   true,
		Refs:       []string{"u"},
		LayoutHint: "layered",
	})
	indeg := tr.Map("indeg", nil)
	done := tr.Map("done", false)
	order := tr.Array("order", n, nil)
	ready := newPQ(tr, "ready", n)

	counts := map[string]int{}
	for _, e := range edges {
		counts[e.V]++
	}
	tr.Group(func() {
		for _, id := range ids(n) {
			indeg.Set(id, counts[id])
		}
	}).Note("count how many tasks each one is waiting on")

	tr.View("graph", "g", 0,
		tracer.Title("dependencies"),
		tracer.Opt("distOf", "indeg"),
		tracer.Opt("settledOf", "done"),
		tracer.Opt("queueOf", "ready"),
		tracer.Opt("cursorRef", "u"),
		tracer.StartHere(tr))
	tr.View("linear", "order", 1, tracer.Title("emitted order"))

	tr.Group(func() {
		for i, id := range ids(n) {
			if counts[id] == 0 {
				// Keyed by declaration index, so ties come out in a fixed order.
				// Any topological order is correct; only ONE of them is
				// reproducible, and a share link needs the reproducible one.
				ready.push(id, i)
			}
		}
	}).Note("everything waiting on nothing is ready immediately")

	emitted := 0
	for ready.len() > 0 {
		u := ready.min()
		tr.Group(func() {
			g.Ref("u", u)
			ready.remove(u)
			done.Set(u, true)
			order.Set(emitted, u)
		}).Note("%s is waiting on nothing -- emit it at position %d", u, emitted+1)
		emitted++

		for i, v := range out[u] {
			left := indeg.Int(v) - 1
			was := indeg.Cell(v)
			tr.Group(func() {
				indeg.Set(v, left).
					Because("%s is done, so %s waits on one fewer", u, v).
					From(was)
				if left == 0 {
					ready.push(v, i)
				}
			}).Note("%s", waitNote(v, left))
		}
	}

	g.Ref("u", "").Note("%s", topoEnd(emitted, n))
	return tr.Err()
}

// waitNote spells the count out. "0 left" is the moment that matters and it
// deserves a sentence rather than a number the reader has to interpret.
func waitNote(v string, left int) string {
	switch left {
	case 0:
		return v + " is waiting on nothing now -- it joins the ready set"
	case 1:
		return v + " is still waiting on 1 task"
	}
	return v + " is still waiting on " + strconv.Itoa(left) + " tasks"
}

// topoEnd reports a CYCLE as the ordinary outcome of running out of ready work
// rather than as an error. A dag() graph cannot produce one, but a hand-written
// trace or a future producer can, and "emitted 5 of 8" is the honest thing to
// say about it.
func topoEnd(emitted, n int) string {
	if emitted == n {
		return "every task is emitted, and no task came before something it depends on"
	}
	return "nothing is ready and " + strconv.Itoa(n-emitted) +
		" tasks remain -- they depend on each other in a cycle"
}
