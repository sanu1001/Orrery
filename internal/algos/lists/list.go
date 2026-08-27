// Package lists holds the linked-list algorithms.
//
// Same story as the trees package: no edge list, no link event. A pointer field
// holding a ref IS an edge, and undoing that write removes it. What differs is
// only the SHAPE — one forward pointer instead of two children — which is why
// the renderer differs and the format does not. ADR 0004.
package lists

import (
	"strconv"

	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

// singly is the schema for a one-way list.
//
// `order` names the pointer field that defines the chain. For a tree it fixed
// which child is drawn left; here there is only one pointer, so it names the
// direction the renderer walks to lay the list out.
func singly(refs ...string) trace.Schema {
	return trace.Schema{
		Fields: map[string]trace.FieldKind{
			"val":  trace.FScalar,
			"next": trace.FPtr,
		},
		Label: "val",
		Order: []string{"next"},
		Refs:  refs,
	}
}

// doubly adds the backward pointer.
//
// The renderer draws `prev` BELOW the row and `next` above, which is the whole
// reason a doubly linked list is readable at all -- both on one line is a ladder
// nobody can follow. RENDERERS/LINKED_LIST.md 4.
func doubly(refs ...string) trace.Schema {
	s := singly(refs...)
	s.Fields["prev"] = trace.FPtr
	s.Order = []string{"next", "prev"}
	return s
}

func nodeID(i int) string { return "n" + strconv.Itoa(i) }

func itoa(n int) string { return strconv.Itoa(n) }

// build lays out a list from values and returns the head id, or "" if empty.
//
// The writes are a CONSTRUCTION PROLOGUE: the player opens past them, because
// watching a list get built is clarifying exactly once. The caller declares
// where that ends with tracer.StartHere. RENDERERS/TREE.md 2.3.
func build(tr *tracer.Tracer, n *tracer.Nodes, vals []int, back bool) string {
	return buildAt(tr, n, vals, back, 0, tr.CallerLine(2))
}

// buildAt is build with an id OFFSET, for the algorithms that need two lists in
// one structure. Ids have to stay unique across both -- they are the identity
// the renderer lays out on -- and a second list starting again at n0 would
// silently overwrite the first.
//
// `ln` is passed rather than captured because the frame count differs between
// the two entry points, and a hand-counted skip that is right for one caller
// and wrong for the other is trap 7 waiting to happen.
func buildAt(tr *tracer.Tracer, n *tracer.Nodes, vals []int, back bool, off, ln int) string {
	if len(vals) == 0 {
		return ""
	}
	for i, v := range vals {
		id := nodeID(off + i)
		if i == 0 {
			n.NewID(id, trace.Record{"val": v}).Line(ln).Note("head is %d", v)
			continue
		}
		prev := nodeID(off + i - 1)
		// Creating the node and linking it is ONE step: a box that appears
		// unattached and joins the chain a step later reads as a glitch.
		tr.Group(func() {
			n.NewID(id, trace.Record{"val": v}).Line(ln)
			n.Link(prev, "next", id).Line(ln)
			if back {
				n.Link(id, "prev", prev).Line(ln)
			}
		}).Note("%d follows %d", v, vals[i-1])
	}
	return nodeID(off)
}

// val reads a node's label as an int. A non-numeric label is a bug in the
// algorithm rather than a case to handle, and returning 0 would bury it.
func val(n *tracer.Nodes, id string) int {
	f, ok := trace.Num(n.Field(id, "val"))
	if !ok {
		panic("lists: node " + id + " has a non-numeric val")
	}
	return int(f)
}

// linkIf and refIf write a pointer only when it would actually change.
//
// Two nodes that were already adjacent need no relink -- the arrow is there,
// put in by whoever built the list -- and writing it again is check V11 and a
// step in which nothing on screen moves. It comes up constantly in the
// algorithms that DEAL a list into chains: a run of nodes going to the same
// side is already linked in the right order.
//
// The line is stamped explicitly because the write now originates in this file,
// and without it the code pane highlights nothing for the step. Trap 7.
func linkIf(tr *tracer.Tracer, n *tracer.Nodes, id, field, target string) *tracer.Ev {
	if n.Ptr(id, field) == target {
		return nil
	}
	ln := tr.CallerLine(2)
	if target == "" {
		return n.Unlink(id, field).Line(ln)
	}
	return n.Link(id, field, target).Line(ln)
}

func refIf(tr *tracer.Tracer, n *tracer.Nodes, name, target string) *tracer.Ev {
	if n.RefTarget(name) == target {
		return nil
	}
	return n.Ref(name, target).Line(tr.CallerLine(2))
}
