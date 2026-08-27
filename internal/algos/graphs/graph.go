// Package graphs holds the graph algorithms.
//
// The graph is DECLARED up front -- nodes and edges in the schema -- rather
// than built by writes, the way trees and lists are. A Dijkstra graph does not
// gain nodes mid-run, and declaring it lets the layout be computed once, before
// the first frame, and then frozen. That is what makes a share link draw the
// same picture every time it is opened. TRACE_FORMAT.md 4.1.
//
// What the algorithms write instead is the STATE over that fixed shape:
// distances, set membership, predecessors, edge verdicts. The renderer draws
// one picture and re-reads it every step, so nothing ever moves.
package graphs

import (
	"sort"
	"strconv"

	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

// id names node i.
//
// Single letters, because the id IS the label drawn inside the circle: "a"
// reads where "node-0" does not, and at the 40-node cap two characters still
// fit. Past 26 it falls back to a number, which only a graph this package
// refuses to draw could reach.
func id(i int) string {
	if i < 26 {
		return string(rune('a' + i))
	}
	return "n" + strconv.Itoa(i)
}

func ids(n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = id(i)
	}
	return out
}

// rng is a fixed LCG. The same n must produce the same graph on every machine,
// or a share link is not reproducible and a measured complexity curve is noise
// from the input wearing the shape of a property of the algorithm. ADR 0007.
type rng uint32

func (r *rng) next(mod int) int {
	*r = *r*1664525 + 1013904223
	if mod <= 0 {
		return 0
	}
	return int(*r>>16) % mod
}

// build is a deterministic connected weighted graph on n nodes.
//
// A spanning tree first, so the picture is one component and every node has a
// distance worth finding. Then n/2 chords, which is what gives Dijkstra a
// choice of routes to compare -- with none, every shortest path is the only
// path and the algorithm has nothing to reject. Many more and n = 12 is a mesh
// nobody can read.
//
// Weights are 1..9: one digit, so an edge label never widens the picture, and
// wide enough that a two-hop route can genuinely beat a one-hop one.
func build(n int) []trace.Edge {
	var r rng = 2166136261
	out := make([]trace.Edge, 0, n+n/2)
	for i := 1; i < n; i++ {
		out = append(out, trace.Edge{U: id(r.next(i)), V: id(i), W: 1 + r.next(9)})
	}
	for k := 0; k < n/2; k++ {
		u, v := r.next(n), r.next(n)
		if u == v || hasEdge(out, id(u), id(v)) {
			continue
		}
		out = append(out, trace.Edge{U: id(u), V: id(v), W: 1 + r.next(9)})
	}
	return out
}

// dag is the same idea with every edge pointing from a lower index to a higher
// one, which is what makes it acyclic by construction rather than by check.
// Topological sort and layered layout both need that guarantee.
func dag(n int) []trace.Edge {
	var r rng = 40503
	out := make([]trace.Edge, 0, n+n/2)
	for i := 1; i < n; i++ {
		out = append(out, trace.Edge{U: id(r.next(i)), V: id(i), W: 1 + r.next(9)})
	}
	for k := 0; k < n/2; k++ {
		u, v := r.next(n), r.next(n)
		if u >= v || hasEdge(out, id(u), id(v)) {
			continue
		}
		out = append(out, trace.Edge{U: id(u), V: id(v), W: 1 + r.next(9)})
	}
	return out
}

// grid builds the graph of an r x c lattice with a deterministic scatter of
// walls removed -- a maze, whose node ids carry their own coordinates so the
// renderer can lay it out as the grid it is instead of as a blob.
func grid(rows, cols int) ([]string, []trace.Edge) {
	var r rng = 987654321
	nodes := make([]string, 0, rows*cols)
	for y := 0; y < rows; y++ {
		for x := 0; x < cols; x++ {
			nodes = append(nodes, cell(y, x))
		}
	}
	var out []trace.Edge
	for y := 0; y < rows; y++ {
		for x := 0; x < cols; x++ {
			// One in five interior walls stays up. Enough that the frontier has
			// to go around something -- a wall-free lattice makes BFS a set of
			// concentric diamonds and teaches nothing about obstacles.
			if x+1 < cols && r.next(5) != 0 {
				out = append(out, trace.Edge{U: cell(y, x), V: cell(y, x+1), W: 1})
			}
			if y+1 < rows && r.next(5) != 0 {
				out = append(out, trace.Edge{U: cell(y, x), V: cell(y+1, x), W: 1})
			}
		}
	}
	return nodes, out
}

// cell names a lattice node so that graphLayout's grid strategy can read the
// coordinates back out of it. Two integers, in row-column order.
func cell(r, c int) string { return strconv.Itoa(r) + "," + strconv.Itoa(c) }

func hasEdge(es []trace.Edge, u, v string) bool {
	for _, e := range es {
		if (e.U == u && e.V == v) || (e.U == v && e.V == u) {
			return true
		}
	}
	return false
}

// adj is the undirected adjacency, sorted, so every algorithm below visits
// neighbours in the same order and two runs of the same input are identical.
func adj(es []trace.Edge, directed bool) map[string][]string {
	out := map[string][]string{}
	for _, e := range es {
		u, v := e.U, e.V
		out[u] = append(out[u], v)
		if !directed {
			out[v] = append(out[v], u)
		}
	}
	for k := range out {
		sort.Strings(out[k])
	}
	return out
}

// weight reads the DECLARED weight of an edge. Current state is what the
// tracer's EdgeCell reads; this is for the algorithm's own arithmetic before
// any relaxation has touched it.
func weight(es []trace.Edge, u, v string) int {
	for _, e := range es {
		if (e.U == u && e.V == v) || (e.U == v && e.V == u) {
			if n, ok := trace.Num(e.W); ok {
				return int(n)
			}
		}
	}
	return 0
}

// ---------------------------------------------------------------------------
// the frontier
// ---------------------------------------------------------------------------

// pq is a priority queue kept as a plain array, mirrored into the trace so the
// Linear renderer can draw it with no graph-specific code at all.
//
// A linear scan for the minimum rather than a binary heap, and that is a
// DELIBERATE choice about what is being taught: the heap is a separate lesson
// with its own renderer (B4), and mixing it in here would put two algorithms on
// screen and make neither legible. The cost is honest -- it makes this O(n^2)
// rather than O(m log n), and the measured complexity curve says so.
type pq struct {
	arr   *tracer.Array
	nodes []string
	keys  []int
}

func newPQ(tr *tracer.Tracer, name string, size int) *pq {
	return &pq{arr: tr.Array(name, size, nil)}
}

func (q *pq) len() int { return len(q.nodes) }

// push adds a node, or lowers the key of one already queued.
func (q *pq) push(node string, key int) {
	for i, n := range q.nodes {
		if n == node {
			q.keys[i] = key
			q.write(i)
			return
		}
	}
	q.nodes = append(q.nodes, node)
	q.keys = append(q.keys, key)
	q.write(len(q.nodes) - 1)
}

// min is the smallest-key node, or "" when empty. It writes NOTHING.
//
// Split from remove so that the caller can name the node before any event is
// emitted. Every write below originates in this file, so the tracer's
// file-match guard gives it no source line -- and the FIRST event of a group is
// the one that supplies the step's line. A pop whose first event is a queue
// shuffle highlights nothing in the code pane, which reads as a bug in the code
// pane. Trap 7 in CLAUDE.md, arriving from an unexpected direction.
func (q *pq) min() string {
	if len(q.nodes) == 0 {
		return ""
	}
	best := 0
	for i := range q.nodes {
		if q.keys[i] < q.keys[best] {
			best = i
		}
	}
	return q.nodes[best]
}

// remove takes a node out of the queue.
//
// The tail is compacted rather than left as a hole: a queue with gaps in it
// reads as a bug in the renderer, and the shifted writes all land inside the
// caller's group, so the whole pop is still one step.
func (q *pq) remove(node string) {
	at := -1
	for i, n := range q.nodes {
		if n == node {
			at = i
			break
		}
	}
	if at < 0 {
		return
	}
	q.nodes = append(q.nodes[:at], q.nodes[at+1:]...)
	q.keys = append(q.keys[:at], q.keys[at+1:]...)
	for i := at; i < len(q.nodes); i++ {
		q.write(i)
	}
	q.clear(len(q.nodes))
}

func (q *pq) write(i int) {
	if i >= q.arr.Len() {
		return
	}
	v := q.nodes[i] + ":" + strconv.Itoa(q.keys[i])
	if s, ok := q.arr.At(i).(string); ok && s == v {
		return // V11: a repeat write with the value already there
	}
	q.arr.Set(i, v)
}

func (q *pq) clear(i int) {
	if i < q.arr.Len() && q.arr.At(i) != nil {
		q.arr.Set(i, nil)
	}
}

// stk is a stack mirrored into a trace array, for the algorithms whose frontier
// is LIFO rather than a priority.
//
// The array is the same structure the graph view reads through `pathRef` to
// stroke the current path, so the picture of the chain and the picture of the
// stack are the same data. Nothing derives one from the other.
type stk struct {
	arr   *tracer.Array
	items []string
}

func newStack(tr *tracer.Tracer, name string, size int) *stk {
	return &stk{arr: tr.Array(name, size, nil)}
}

func (s *stk) len() int { return len(s.items) }

func (s *stk) push(node string) {
	if len(s.items) >= s.arr.Len() {
		return
	}
	s.items = append(s.items, node)
	s.arr.Set(len(s.items)-1, node)
}

func (s *stk) pop() string {
	if len(s.items) == 0 {
		return ""
	}
	top := s.items[len(s.items)-1]
	s.items = s.items[:len(s.items)-1]
	s.arr.Set(len(s.items), nil)
	return top
}

func (s *stk) peek() string {
	if len(s.items) == 0 {
		return ""
	}
	return s.items[len(s.items)-1]
}

func (s *stk) has(node string) bool {
	for _, n := range s.items {
		if n == node {
			return true
		}
	}
	return false
}

// look records that v is being examined from u, and hands back the event so the
// caller can attach the arithmetic and the verdict.
//
// THE VALUE IS THE NODE IT IS BEING EXAMINED FROM, not the candidate distance,
// and that is what makes the write always a real change. Two different nodes
// offering v the same number is common -- in a unit-weight BFS it is the normal
// case -- and a write of the value already there is check V11 and a step whose
// state does not move.
//
// Returns nil when v was last examined from this same u, which happens when DFS
// backtracks into a node and rescans it. Skipping is both the guard and a small
// mercy: re-announcing the same dead end on every pass is the kind of repetition
// that makes a trace tedious, and the step already said it once. Ev's methods
// are nil-safe, so the caller still chains onto it.
func look(tr *tracer.Tracer, via *tracer.Map, v, u string) *tracer.Ev {
	if s, ok := via.At(v).(string); ok && s == u {
		return nil
	}
	// The write originates HERE, so the tracer's file-match guard would leave it
	// with no source line and the code pane would highlight nothing for the step
	// that examines an edge. Trap 7.
	return via.Set(v, u).Lvl(1).Line(tr.CallerLine(2))
}
