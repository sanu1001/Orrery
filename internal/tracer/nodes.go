package tracer

import (
	"github.com/sanu1001/orrery/internal/trace"
)

// Nodes is a structure with identity rather than indices: linked lists, trees,
// tries.
//
// Every operation below is an ordinary `set` with a path. There is no link
// event, no node event, no edge event. Topology is DERIVED by the renderer from
// the pointer fields declared in the schema, so it cannot disagree with state
// after a rewind. ADR 0004.
type Nodes struct {
	t    *Tracer
	name string
	sch  trace.Schema
}

func (t *Tracer) Nodes(name string, sch trace.Schema) *Nodes {
	s := sch
	t.emit(2, trace.Event{T: trace.Init, S: name, Kind: trace.KindNodes, Schema: &s})
	return &Nodes{t: t, name: name, sch: s}
}

func (n *Nodes) Name() string { return n.name }

// New creates a node and returns its id. Ids are minted in creation order so
// layout tie-breaking is deterministic.
func (n *Nodes) New(fields trace.Record) (string, *Ev) {
	id := n.t.nodeID()
	return id, n.newWithID(3, id, fields)
}

// NewID creates a node with a caller-chosen id. Used by parsers that want the
// id to carry provenance -- the LeetCode array parser mints n<tokenIndex> so a
// gap in the ids is itself informative when debugging.
func (n *Nodes) NewID(id string, fields trace.Record) *Ev {
	return n.newWithID(3, id, fields)
}

func (n *Nodes) newWithID(skip int, id string, fields trace.Record) *Ev {
	rec := trace.Record{}
	for f := range n.sch.Fields {
		rec[f] = nil
	}
	for k, v := range fields {
		rec[k] = trace.Normalize(v)
	}
	at := trace.Path{trace.Key(id)}
	return n.t.emit(skip, trace.Event{
		T: trace.Set, S: n.name, At: at,
		From: n.t.state.Get(n.name, at), To: rec,
	})
}

// SetField writes one field of one node.
func (n *Nodes) SetField(id, field string, v trace.Value) *Ev {
	return n.setField(3, id, field, v)
}

func (n *Nodes) setField(skip int, id, field string, v trace.Value) *Ev {
	at := trace.Path{trace.Key(id), trace.Key(field)}
	return n.t.emit(skip, trace.Event{
		T: trace.Set, S: n.name, At: at,
		From: n.t.state.Get(n.name, at), To: trace.Normalize(v),
	})
}

// Link points id.field at target. Pure sugar over SetField -- it exists only so
// algorithm code reads like the algorithm.
func (n *Nodes) Link(id, field, target string) *Ev {
	return n.setField(3, id, field, trace.Ref{ID: target})
}

// Unlink clears id.field.
func (n *Nodes) Unlink(id, field string) *Ev {
	return n.setField(3, id, field, nil)
}

// Delete removes a node. The renderer sees from=object, to=null and animates an
// exit; nothing tells it that explicitly.
func (n *Nodes) Delete(id string) *Ev {
	at := trace.Path{trace.Key(id)}
	return n.t.emit(2, trace.Event{
		T: trace.Set, S: n.name, At: at,
		From: n.t.state.Get(n.name, at), To: nil,
	})
}

// Ref moves a named pointer (head, slow, cur). This is how two-pointer and
// cycle-detection algorithms become visible: the pointer moving IS a write, so
// it IS a step, with provenance and an explanation.
func (n *Nodes) Ref(name, target string) *Ev {
	at := trace.Path{trace.Key(trace.NSRefs), trace.Key(name)}
	var to trace.Value
	if target != "" {
		to = trace.Ref{ID: target}
	}
	return n.t.emit(2, trace.Event{
		T: trace.Set, S: n.name, At: at,
		From: n.t.state.Get(n.name, at), To: to,
	})
}

// Field reads one field.
func (n *Nodes) Field(id, field string) trace.Value {
	return n.t.state.Get(n.name, trace.Path{trace.Key(id), trace.Key(field)})
}

// Ptr reads a pointer field as a node id, or "" if nil.
func (n *Nodes) Ptr(id, field string) string {
	r, _ := trace.AsRef(n.Field(id, field))
	return r
}

// RefTarget reads a named pointer as a node id, or "".
func (n *Nodes) RefTarget(name string) string {
	r, _ := trace.AsRef(n.t.state.Get(n.name, trace.Path{trace.Key(trace.NSRefs), trace.Key(name)}))
	return r
}

func (n *Nodes) Cell(id, field string) Cell {
	at := trace.Path{trace.Key(id), trace.Key(field)}
	return Cell{S: n.name, At: at, V: n.t.state.Get(n.name, at)}
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

// Graph is a nodes structure whose node and edge sets are declared UP FRONT.
//
// Declaring them lets the layout be computed once, before the first frame, and
// frozen -- which is what makes a seeded force layout reproduce pixel-for-pixel
// in a shared link. An incrementally built graph should use Nodes instead.
type Graph struct {
	t    *Tracer
	name string
	sch  trace.Schema
}

func (t *Tracer) Graph(name string, sch trace.Schema) *Graph {
	s := sch
	if s.LayoutHint == "" {
		s.LayoutHint = "force"
	}
	t.emit(2, trace.Event{T: trace.Init, S: name, Kind: trace.KindGraph, Schema: &s})
	g := &Graph{t: t, name: name, sch: s}
	// Seed the edge attributes so a relaxation has a `from` to record.
	t.Group(func() {
		for _, e := range s.Edges {
			u, v := trace.OrientEdge(e.U, e.V, s.Directed)
			g.setEdge(4, u, v, "w", e.W)
		}
	}).Note("graph")
	return g
}

func (g *Graph) Name() string         { return g.name }
func (g *Graph) Schema() trace.Schema { return g.sch }

func (g *Graph) SetEdge(u, v, field string, val trace.Value) *Ev {
	uu, vv := trace.OrientEdge(u, v, g.sch.Directed)
	return g.setEdge(3, uu, vv, field, val)
}

func (g *Graph) setEdge(skip int, u, v, field string, val trace.Value) *Ev {
	at := trace.Path{trace.Key(trace.NSEdges), trace.Key(trace.EdgeKey(u, v)), trace.Key(field)}
	return g.t.emit(skip, trace.Event{
		T: trace.Set, S: g.name, At: at,
		From: g.t.state.Get(g.name, at), To: trace.Normalize(val),
	})
}

func (g *Graph) EdgeCell(u, v, field string) Cell {
	uu, vv := trace.OrientEdge(u, v, g.sch.Directed)
	at := trace.Path{trace.Key(trace.NSEdges), trace.Key(trace.EdgeKey(uu, vv)), trace.Key(field)}
	return Cell{S: g.name, At: at, V: g.t.state.Get(g.name, at)}
}

// Ref moves a named pointer, e.g. the node currently being settled.
func (g *Graph) Ref(name, node string) *Ev {
	at := trace.Path{trace.Key(trace.NSRefs), trace.Key(name)}
	var to trace.Value
	if node != "" {
		to = trace.Ref{ID: node}
	}
	return g.t.emit(2, trace.Event{
		T: trace.Set, S: g.name, At: at,
		From: g.t.state.Get(g.name, at), To: to,
	})
}
