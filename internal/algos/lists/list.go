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

// build lays out a list from values and returns the head id, or "" if empty.
//
// The writes are a CONSTRUCTION PROLOGUE: the player opens past them, because
// watching a list get built is clarifying exactly once. The caller declares
// where that ends with tracer.StartHere. RENDERERS/TREE.md 2.3.
func build(tr *tracer.Tracer, n *tracer.Nodes, vals []int, back bool) string {
	// One frame up is the algorithm. Without stamping its line on these writes
	// the code pane highlights nothing, because they originate in this file
	// rather than the one being displayed.
	ln := tr.CallerLine(2)
	if len(vals) == 0 {
		return ""
	}
	for i, v := range vals {
		id := nodeID(i)
		if i == 0 {
			n.NewID(id, trace.Record{"val": v}).Line(ln).Note("head is %d", v)
			continue
		}
		prev := nodeID(i - 1)
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
	return nodeID(0)
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
