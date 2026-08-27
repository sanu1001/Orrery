package trees

import (
	_ "embed"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed bstdelete.go
var bstDeleteSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "bst-delete",
		Title:  "BST Delete",
		Family: "Trees",
		Blurb:  "Three cases: a leaf goes, one child is promoted, and two children need the successor.",
		Inputs: []algos.InputSpec{
			{Name: "values", Kind: "intList", Max: 24,
				Default: []int{8, 3, 10, 1, 6, 14, 4, 7, 13},
				Help:    "inserted in this order to build the tree"},
			{Name: "remove", Kind: "int", Min: -999, Max: 999, Default: 3,
				Help: "the value to delete"},
		},
		Defaults: algos.Args{
			"values": []int{8, 3, 10, 1, 6, 14, 4, 7, 13}, "remove": 3,
		},
		Source:     trace.Source{Path: "internal/algos/trees/bstdelete.go", Text: bstDeleteSrc, FirstLine: 1},
		Tags:       []string{"tree", "bst", "pointers"},
		Complexity: "O(n)",
		Sweep:      []string{"values"},
		Run:        runBSTDelete,
	})
}

// DELETE IS THE ALGORITHM THAT NEEDS A PICTURE, and insert is the one that does
// not. Insert has one case: walk down, hang a node off an empty slot. Delete
// has three, the third is the only interesting one, and the third is the reason
// people get it wrong.
//
// Two children means the node's VALUE has to go while its position stays --
// there is no way to unhook it without orphaning a subtree. So the in-order
// successor's value is copied up and the successor, which by construction has
// at most one child, is deleted instead. Watching that copy happen and then the
// leftover node vanish from the bottom of the right subtree is the whole
// lesson, and it is very hard to follow in prose.
//
// The successor gets its own named pointer so the two positions are both on
// screen at once. That is what `refs` are for: a second place the algorithm is
// looking, visible at the same time as the first.
func runBSTDelete(tr *tracer.Tracer, args algos.Args) error {
	vals := args.Ints("values")
	target := args.Int("remove")

	t := tr.Nodes("tree", binaryTree("root", "cur", "succ"))
	root := insertAll(tr, t, vals)
	tr.View("tree", "tree", 0, tracer.Title("binary search tree"), tracer.StartHere(tr))

	if root == "" {
		return tr.Err()
	}

	// The descent, and the parent kept alongside it. A BST node does not know
	// its parent, so the search has to carry it -- and that is why deleting from
	// a tree is fiddlier than it looks from a picture.
	cur, parent, side := root, "", ""
	for cur != "" {
		cv := val(t, cur)
		t.Ref("cur", cur).
			Because("compare %d with %d", target, cv).
			From(t.Cell(cur, "val"))
		if cv == target {
			break
		}
		side = "right"
		if target < cv {
			side = "left"
		}
		parent, cur = cur, t.Ptr(cur, side)
	}

	if cur == "" {
		t.Ref("cur", "").Note("%d is not in the tree -- nothing to delete", target)
		return tr.Err()
	}

	l, r := t.Ptr(cur, "left"), t.Ptr(cur, "right")
	gone := target

	if l != "" && r != "" {
		// CASE THREE. The in-order successor is the smallest value to the right:
		// one step right, then left as far as it goes.
		sp, s := cur, r
		t.Ref("succ", s).Note("the successor is the smallest value to the right")
		for t.Ptr(s, "left") != "" {
			sp, s = s, t.Ptr(s, "left")
			t.Ref("succ", s).Note("left again -- %d is smaller", val(t, s))
		}

		sv := val(t, s)
		t.SetField(cur, "val", sv).
			Because("%d is the next value up from %d", sv, target).
			From(t.Cell(s, "val")).
			Note("copy %d up -- the node stays where it is, its value changes", sv)

		// Which side of its own parent the successor hangs off. When the walk
		// never went left, the successor IS the right child of the node being
		// deleted, and that asymmetry is the one thing this case gets wrong when
		// it is written from memory.
		side = "left"
		if sp == cur {
			side = "right"
		}
		// The successor has at most one child by construction -- nothing can be
		// to its left or it would not be the smallest -- so removing it is case
		// one or case two. The two-children case never recurses twice.
		parent, cur, gone = sp, s, sv
		l, r = t.Ptr(cur, "left"), t.Ptr(cur, "right")
		tr.Group(func() {
			t.Ref("succ", "")
			t.Ref("cur", cur)
		}).Note("now remove the node the value came from")
	}

	child := l
	if child == "" {
		child = r
	}
	note := deleteNote(t, gone, child)

	tr.Group(func() {
		if parent == "" {
			// The root going means the tree gets a new one, or none at all.
			t.Ref("root", child)
		} else {
			setChild(t, parent, side, child)
		}
		t.Ref("cur", "")
		t.Delete(cur)
	}).Note("%s", note)

	return tr.Err()
}

// insertAll builds the tree as a CONSTRUCTION PROLOGUE. It is the same descent
// bst.go traces step by step, collapsed to one step per value here, because in
// this algorithm the build is setup and the delete is the subject.
func insertAll(tr *tracer.Tracer, t *tracer.Nodes, vals []int) string {
	ln := tr.CallerLine(2)
	root := ""
	for _, v := range vals {
		if root == "" {
			id, _ := t.New(trace.Record{"val": v})
			root = id
			t.Ref("root", id).Line(ln).Note("%d becomes the root", v)
			continue
		}
		cur := root
		for {
			cv := val(t, cur)
			if v == cv {
				break
			}
			field := "right"
			if v < cv {
				field = "left"
			}
			next := t.Ptr(cur, field)
			if next == "" {
				parent := cur
				tr.Group(func() {
					id, _ := t.New(trace.Record{"val": v})
					t.Link(parent, field, id).Line(ln)
				}).Note("insert %d", v)
				break
			}
			cur = next
		}
	}
	return root
}

// deleteNote is built BEFORE the group runs, because it reads the child that
// the group is about to relink and the node it is about to delete.
func deleteNote(t *tracer.Nodes, gone int, child string) string {
	if child == "" {
		return itoa(gone) + " is a leaf -- unhook it and it is gone"
	}
	return itoa(val(t, child)) + " takes " + itoa(gone) + "'s place: its one child is promoted"
}
