package trees

import (
	"testing"

	"github.com/sanu1001/orrery/internal/tracer"
)

// build runs the parser against a live tracer and hands back the node handle so
// the resulting topology can be read straight out of state -- which is the only
// place it exists. There is no edge list to inspect instead.
func build(t *testing.T, toks ...any) (*tracer.Nodes, string) {
	t.Helper()
	tr := tracer.New(tracer.Config{Algo: "test"})
	n := tr.Nodes("tree", binaryTree("root"))
	return n, buildLeetCode(tr, n, toks)
}

// The case the whole notation turns on. Under level-order-with-omissions, 3 and
// 4 are children of 2; under heap indexing they would hang off the null and be
// thrown away. Getting this backwards produces a tree that looks plausible and
// is wrong, which is why it is the first test in the file.
func TestLeetCodeChildrenOfNullAreNotListed(t *testing.T) {
	n, root := build(t, 1, 2, nil, 3, 4)

	if root != "n0" {
		t.Fatalf("root = %q, want n0", root)
	}
	if got := n.Ptr("n0", "left"); got != "n1" {
		t.Errorf("n0.left = %q, want n1 (the 2)", got)
	}
	if got := n.Ptr("n0", "right"); got != "" {
		t.Errorf("n0.right = %q, want empty (the null)", got)
	}
	// The payoff: both remaining tokens belong to the 2, not to the missing node.
	if got := n.Ptr("n1", "left"); got != "n3" {
		t.Errorf("n1.left = %q, want n3 (the 3)", got)
	}
	if got := n.Ptr("n1", "right"); got != "n4" {
		t.Errorf("n1.right = %q, want n4 (the 4)", got)
	}
	if got := val(n, "n3"); got != 3 {
		t.Errorf("n3.val = %d, want 3", got)
	}
}

// Ids carry the token index, gaps included. n2 is absent because token 2 was a
// null, and that gap is the feature: an id points back at a position in the
// input.
func TestLeetCodeIDsCarryTheTokenIndex(t *testing.T) {
	n, _ := build(t, 1, 2, nil, 3, 4)
	for _, id := range []string{"n0", "n1", "n3", "n4"} {
		if n.Ptr(id, "left") == "" && n.Ptr(id, "right") == "" && val(n, id) == 0 {
			t.Errorf("%s does not exist", id)
		}
	}
	if got := n.Field("n2", "val"); got != nil {
		t.Errorf("n2 exists with val %v; token 2 was null, so it must not", got)
	}
}

// Every one of these read past the end of the token slice in the obvious
// implementation, where a single bounds check guards both child slots.
func TestLeetCodeShortInputs(t *testing.T) {
	cases := []struct {
		name  string
		toks  []any
		root  string
		left  string
		right string
	}{
		{"two tokens", []any{1, 2}, "n0", "n1", ""},
		{"empty", nil, "", "", ""},
		{"single null", []any{nil}, "", "", ""},
		{"right child only", []any{1, nil, 2}, "n0", "", "n2"},
		{"single node", []any{1}, "n0", "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			n, root := build(t, c.toks...)
			if root != c.root {
				t.Fatalf("root = %q, want %q", root, c.root)
			}
			if root == "" {
				return
			}
			if got := n.Ptr(root, "left"); got != c.left {
				t.Errorf("root.left = %q, want %q", got, c.left)
			}
			if got := n.Ptr(root, "right"); got != c.right {
				t.Errorf("root.right = %q, want %q", got, c.right)
			}
		})
	}
}

// A complete tree of 31 nodes, which is the input cap. Checks the queue keeps
// its level-order discipline all the way down rather than only for the first
// two levels.
func TestLeetCodeCompleteTree(t *testing.T) {
	toks := make([]any, 31)
	for i := range toks {
		toks[i] = i + 1
	}
	n, root := build(t, toks...)
	if root != "n0" {
		t.Fatalf("root = %q", root)
	}
	// In a complete tree laid out level-order, node i's children are 2i+1 and
	// 2i+2 -- the one case where the two conventions agree, because no token is
	// null.
	for i := 0; i < 15; i++ {
		id := nodeID(i)
		if got, want := n.Ptr(id, "left"), nodeID(2*i+1); got != want {
			t.Errorf("%s.left = %q, want %q", id, got, want)
		}
		if got, want := n.Ptr(id, "right"), nodeID(2*i+2); got != want {
			t.Errorf("%s.right = %q, want %q", id, got, want)
		}
	}
	for i := 15; i < 31; i++ {
		id := nodeID(i)
		if got := n.Ptr(id, "left"); got != "" {
			t.Errorf("leaf %s has left = %q", id, got)
		}
	}
}
