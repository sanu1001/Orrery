package trace

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
)

// Seg is one path segment: either an integer index or a string key/field.
type Seg struct {
	IsIdx bool
	I     int
	S     string
}

func Idx(i int) Seg    { return Seg{IsIdx: true, I: i} }
func Key(s string) Seg { return Seg{S: s} }

func (s Seg) String() string {
	if s.IsIdx {
		return strconv.Itoa(s.I)
	}
	return s.S
}

// Path addresses one cell, field or pointer inside a structure.
//
//	[]                       the structure itself (a scalar)
//	[3, 4]                   a grid cell -- identical wire form to the original
//	                         integer-index spec, by design
//	["n7", "next"]           a node's pointer field
//	["$refs", "slow"]        a named pointer into a nodes/graph structure
//	["$edges", "a|b", "w"]   an edge attribute
//
// Reserved first segments: "$refs", "$edges". A node id may not begin with '$'
// (validator check V12). See ADR 0004 for why this is a path rather than a
// separate family of node/edge events.
type Path []Seg

// P is shorthand for building a path from mixed ints and strings.
// Panics on any other type -- it is a construction helper, not a decoder.
func P(segs ...any) Path {
	out := make(Path, len(segs))
	for i, s := range segs {
		switch t := s.(type) {
		case int:
			out[i] = Idx(t)
		case string:
			out[i] = Key(t)
		default:
			panic("trace.P: segment must be int or string")
		}
	}
	return out
}

func (p Path) MarshalJSON() ([]byte, error) {
	raw := make([]any, len(p))
	for i, s := range p {
		if s.IsIdx {
			raw[i] = s.I
		} else {
			raw[i] = s.S
		}
	}
	return json.Marshal(raw)
}

func (p *Path) UnmarshalJSON(b []byte) error {
	var raw []any
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	out := make(Path, len(raw))
	for i, v := range raw {
		switch t := v.(type) {
		case float64:
			out[i] = Idx(int(t))
		case string:
			out[i] = Key(t)
		default:
			return errors.New("trace: path segment must be a number or a string")
		}
	}
	*p = out
	return nil
}

// Join renders the path segments separated by '/'.
func (p Path) Join() string {
	var b strings.Builder
	b.Grow(4 * len(p))
	for i, s := range p {
		if i > 0 {
			b.WriteByte('/')
		}
		b.WriteString(s.String())
	}
	return b.String()
}

// KeyWith returns the canonical address key: the structure name, a space, then
// the segments joined by '/'.
//
//	KeyWith("dp") on [3,4]            -> "dp 3/4"
//	KeyWith("L")  on ["$refs","slow"] -> "L $refs/slow"
//
// CRITICAL: web/src/lib/value.js addrKey() must produce byte-identical output.
// The conformance suite compares state hashes built from these keys, so a
// mismatch fails CI in a confusing way. Change one, change both.
func (p Path) KeyWith(structName string) string {
	return structName + " " + p.Join()
}

// Equal reports whether two paths address the same location.
func (p Path) Equal(q Path) bool {
	if len(p) != len(q) {
		return false
	}
	for i := range p {
		if p[i] != q[i] {
			return false
		}
	}
	return true
}

// Reserved path namespaces.
const (
	NSRefs  = "$refs"
	NSEdges = "$edges"
)

// EdgeKey builds the canonical edge segment for a graph edge. Undirected
// graphs must call this with a stable orientation, which OrientEdge provides.
func EdgeKey(u, v string) string { return u + "|" + v }

// OrientEdge returns (u, v) in a stable order for an undirected graph, so that
// a|b and b|a address the same edge.
func OrientEdge(u, v string, directed bool) (string, string) {
	if !directed && v < u {
		return v, u
	}
	return u, v
}
