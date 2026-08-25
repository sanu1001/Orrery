package trace

// Kind is the shape of a structure. It determines how At is interpreted and
// what the default renderer family is.
type Kind string

const (
	KindScalar Kind = "scalar" // addressed by []
	KindArray  Kind = "array"  // dims [n],         addressed by [i]
	KindGrid   Kind = "grid"   // dims [rows,cols], addressed by [r,c]
	KindMap    Kind = "map"    // addressed by [key] (or a nested key path)
	KindNodes  Kind = "nodes"  // [nodeId] / [nodeId,field] / [$refs,name]
	KindGraph  Kind = "graph"  // as nodes, plus [$edges,"u|v",field]
)

// IsNodeKind reports whether At is interpreted as a nested path into node
// records rather than as a flat coordinate.
func (k Kind) IsNodeKind() bool { return k == KindNodes || k == KindGraph }

// FieldKind describes one field of a node.
type FieldKind string

const (
	// FScalar is a displayable value.
	FScalar FieldKind = "scalar"
	// FPtr is a node reference. THE RENDERER DERIVES EDGES FROM THESE: the edge
	// set is exactly {(n, f, v) : f is a ptr field and state[n][f] != null}.
	// Topology is never asserted by an event. See ADR 0004.
	FPtr FieldKind = "ptr"
	// FSet is a list of node references (adjacency).
	FSet FieldKind = "set"
)

// Schema declares the shape of a nodes or graph structure.
type Schema struct {
	// --- nodes ---
	Fields map[string]FieldKind `json:"fields,omitempty"`
	Label  string               `json:"label,omitempty"`
	// Order fixes child draw order, e.g. ["left","right"]. This is what makes
	// layout deterministic regardless of insertion order: a left child is drawn
	// left even before the right child exists. RENDERERS/TREE.md 3.
	Order []string `json:"order,omitempty"`

	// Refs are named pointers addressed at ["$refs", name]: head, slow, cur.
	Refs []string `json:"refs,omitempty"`

	// --- graph ---
	// Nodes and Edges are declared statically because a Dijkstra graph does not
	// gain nodes mid-run, and declaring them lets layout be computed once,
	// before the first frame. For an incrementally built graph use KindNodes.
	Nodes    []string `json:"nodes,omitempty"`
	Edges    []Edge   `json:"edges,omitempty"`
	Directed bool     `json:"directed,omitempty"`
	Weighted bool     `json:"weighted,omitempty"`

	// LayoutHint selects the layout strategy: force | circle | layered | grid.
	// Chosen by PROVENANCE, not by algorithm: a maze-derived graph gets "grid",
	// a DAG gets "layered". RENDERERS/GRAPH.md 1.
	LayoutHint string `json:"layoutHint,omitempty"`
}

// Edge is a declared graph edge.
type Edge struct {
	U string `json:"u"`
	V string `json:"v"`
	W Value  `json:"w,omitempty"`
}

// PtrFields returns the field names declared as pointers, in Order when Order
// is set, otherwise sorted -- either way deterministic.
func (s *Schema) PtrFields() []string {
	if s == nil {
		return nil
	}
	if len(s.Order) > 0 {
		out := make([]string, 0, len(s.Order))
		for _, f := range s.Order {
			if s.Fields[f] == FPtr {
				out = append(out, f)
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	var out []string
	for name, k := range s.Fields {
		if k == FPtr {
			out = append(out, name)
		}
	}
	sortStrings(out)
	return out
}

func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}
