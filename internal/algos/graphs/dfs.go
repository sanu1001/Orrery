package graphs

import (
	_ "embed"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed dfs.go
var dfsSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "dfs",
		Title:  "Depth-First Search",
		Family: "Graphs",
		Blurb:  "Follow one path as far as it goes, then back up to the last untried branch.",
		Inputs: []algos.InputSpec{
			{Name: "n", Kind: "int", Min: 4, Max: 12, Default: 8,
				Help: "nodes; the edges are generated deterministically"},
		},
		Defaults: algos.Args{"n": 8},
		Source:   trace.Source{Path: "internal/algos/graphs/dfs.go", Text: dfsSrc, FirstLine: 1},
		Tags:     []string{"graph", "traversal", "stack"},
		// O(V + E), and the swept family has E = 1.5V, so O(n) in the swept input.
		Complexity: "O(n)",
		Sweep:      []string{"n"},
		Run:        runDFS,
	})
}

// DFS IS ITERATIVE HERE FOR A REASON THAT IS ABOUT THE PICTURE, not about the
// stack depth.
//
// The recursive version's frontier lives in Go's call stack, where the trace
// cannot see it, and the visualization would be a wandering cursor with no
// visible reason for where it goes next. Written with an explicit stack, the
// frontier is an ordinary array -- so it renders in the side pane with the
// Linear renderer, and the same array is what `pathRef` strokes as the current
// chain in the graph. The picture of the stack and the picture of the path are
// the same data, read twice.
//
// A recursive version would still be worth having for the call-stack pane; it
// would be a different algorithm entry, not a different renderer.
func runDFS(tr *tracer.Tracer, args algos.Args) error {
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
	seen := tr.Map("seen", false)
	order := tr.Map("order", nil)
	pred := tr.Map("pred", nil)
	via := tr.Map("via", nil).Aux()
	path := newStack(tr, "path", n)

	tr.View("graph", "g", 0,
		tracer.Title("graph"),
		tracer.Opt("distOf", "order"),
		tracer.Opt("settledOf", "seen"),
		tracer.Opt("predOf", "pred"),
		tracer.Opt("pathRef", "path"),
		tracer.Opt("cursorRef", "u"),
		tracer.Opt("probeOf", "via"),
		tracer.StartHere(tr))
	tr.View("linear", "path", 1, tracer.Title("the path so far"))

	visited := 0
	tr.Group(func() {
		path.push(src)
		g.Ref("u", src)
		seen.Set(src, true)
		order.Set(src, visited)
	}).Note("start at %s", src)
	visited++

	for path.len() > 0 {
		u := path.peek()
		next := ""
		for _, v := range nb[u] {
			if seen.At(v) == true {
				// The rejected neighbours are the reason a DFS looks arbitrary
				// until you can see them. At level 1 every one of them is a step.
				look(tr, via, v, u).
					Note("%s has been visited -- not a way forward from %s", v, u)
				continue
			}
			next = v
			break
		}

		if next == "" {
			// BACKTRACKING IS A WRITE, which is what makes it a step at all. Pop
			// the stack and the path edge disappears from the picture on its own,
			// because the renderer strokes whatever the array currently holds.
			tr.Group(func() {
				path.pop()
				g.Ref("u", path.peek())
			}).Note("%s", backtrackNote(u, path.len()))
			continue
		}

		// Both cells are read BEFORE the group writes anything. A Cell snapshots
		// the value at construction, so building it after seen.Set would record
		// "chosen because it was already visited" -- provenance that contradicts
		// the branch it is attached to.
		unvisited := seen.Cell(next)
		via := g.EdgeCell(u, next, "w")
		tr.Group(func() {
			seen.Set(next, true)
			order.Set(next, visited).
				Because("%s is the first unvisited neighbour of %s", next, u).
				From(unvisited, via)
			pred.Set(next, u)
			path.push(next)
			g.Ref("u", next)
		}).Note("go deeper: %s is visit number %d", next, visited+1)
		visited++
	}
	return tr.Err()
}

func backtrackNote(u string, left int) string {
	if left == 0 {
		return "the stack is empty -- the walk is back where it started"
	}
	return u + " has no unvisited neighbours -- back up"
}
