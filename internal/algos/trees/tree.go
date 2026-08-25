// Package trees holds the algorithms that build and walk binary trees.
//
// Everything here declares the same schema, and none of it knows anything about
// the renderer. Topology is never asserted: there is no edge list and no link
// event, only ordinary writes to pointer fields, and the renderer reads the
// edges back out of state. That is what makes rewind correct for free -- undo
// the write and the edge is gone, because there was never a second record of it
// to fall out of sync. ADR 0004, RENDERERS/TREE.md 1.
package trees

import (
	"strconv"

	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

// binaryTree is the schema every algorithm in this package declares.
//
// `order` is the load-bearing field, and it is worth being clear about why it
// exists at all. It fixes the DRAW order of the children, which makes the
// picture deterministic regardless of the order the algorithm happens to create
// them in: left is drawn on the left even before the right child exists, and
// even before left itself exists. Without it, a BST that inserts a right child
// first would draw that child on the left, and the picture would contradict the
// code that produced it. Determinism comes from the declaration, never from
// insertion order. RENDERERS/TREE.md 3.
func binaryTree(refs ...string) trace.Schema {
	return trace.Schema{
		Fields: map[string]trace.FieldKind{
			"val":   trace.FScalar,
			"left":  trace.FPtr,
			"right": trace.FPtr,
		},
		Label: "val",
		Order: []string{"left", "right"},
		Refs:  refs,
	}
}

// nodeID names a node after the TOKEN INDEX that produced it, so
// [1,2,null,3,4] yields n0, n1, n3, n4. The gap at n2 is deliberate: an id
// traces straight back to a position in the input while debugging, and ids stay
// stable when a later token changes. RENDERERS/TREE.md 2.1.
func nodeID(i int) string { return "n" + strconv.Itoa(i) }

// buildLeetCode builds a binary tree from level-order tokens, emitting the
// writes as it goes, and returns the root's id ("" for an empty tree).
//
// THE SUBTLETY, which trips everyone: CHILDREN OF NULL NODES ARE NOT LISTED.
// This is a level-order serialization with omissions, not heap indexing. In
// [1,2,null,3,4] the 3 and 4 are children of 2 — the missing node never enters
// the queue, so it never consumes tokens for children it cannot have.
//
// Under heap indexing the very same tokens describe a DIFFERENT tree, one where
// 3 and 4 hang off the null and are discarded. The two cannot be told apart by
// looking at the tokens, which is why InputSpec.Notation declares the convention
// instead of anyone trying to detect it. RENDERERS/TREE.md 2.2.
func buildLeetCode(tr *tracer.Tracer, n *tracer.Nodes, toks []any) string {
	// One frame up is the algorithm that called us. Stamping its line on every
	// prologue write is what makes the code pane highlight "build the input"
	// rather than nothing at all; the writes originate in THIS file, which is
	// not the file the code pane is showing.
	ln := tr.CallerLine(2)

	if len(toks) == 0 || toks[0] == nil {
		return ""
	}
	root := nodeID(0)
	n.NewID(root, trace.Record{"val": toks[0]}).Line(ln).Note("root is %v", toks[0])

	queue := []string{root}
	i := 1
	for len(queue) > 0 && i < len(toks) {
		parent := queue[0]
		queue = queue[1:]

		// The two bounds checks are SEPARATE, one per child slot. A single
		// check around the pair lets [1,2] read past the end while looking for
		// 1's right child.
		for _, field := range [2]string{"left", "right"} {
			if i >= len(toks) {
				break
			}
			tok := toks[i]
			i++
			if tok == nil {
				continue
			}
			id := nodeID(i - 1)
			pv := n.Field(parent, "val")
			// Creating the node and hanging it off its parent is ONE step. Two
			// steps would show a node floating unattached, which reads as a bug
			// in the picture rather than as a half-finished link.
			tr.Group(func() {
				n.NewID(id, trace.Record{"val": tok}).Line(ln)
				n.Link(parent, field, id).Line(ln)
			}).Note("%v is the %s child of %v", tok, field, pv)
			queue = append(queue, id)
		}
	}
	return root
}

// val reads a node's label field as an int.
//
// Trees here hold ints, so a non-numeric label is a bug in the algorithm rather
// than a case to handle; returning 0 would hide it inside a comparison and turn
// a loud failure into a wrong tree.
func val(n *tracer.Nodes, id string) int {
	f, ok := trace.Num(n.Field(id, "val"))
	if !ok {
		panic("trees: node " + id + " has a non-numeric val")
	}
	return int(f)
}
