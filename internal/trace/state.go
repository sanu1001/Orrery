package trace

import (
	"fmt"
	"sort"
)

// State is the algorithm state at some point in a trace, plus the call stack.
//
// The semantics of applying an event live here rather than in a player,
// because "what does this event mean" is a property of the FORMAT. A player is
// navigation on top of these two functions.
//
// STORAGE MODEL, and the JS twin must match it exactly or conformance fails:
//
//   - scalar / array / grid / map : one flat map keyed by at.Join().
//     A missing key reads as Fill.
//   - nodes / graph               : at[0] selects a top-level slot (a node id,
//     "$refs" or "$edges"); further segments descend into Records.
//
// Grid and array are stored SPARSELY (only written cells are present) and read
// through to Fill. That is deliberate: it makes forward-then-backward return to
// a byte-identical state with no special casing, because StateHash skips any
// value equal to Fill. Present-with-fill and absent hash identically.
type State struct {
	Structs map[string]*Struct
	order   []string // struct creation order, for stable non-hash iteration

	// Stack holds the event indices of currently-open calls, oldest first.
	Stack []int

	// retToCall pairs every ret event with its call, computed once in NewState.
	// Backward stepping through a ret needs to know which frame to restore, and
	// scanning for it would make Prev O(n).
	retToCall map[int]int
}

// Struct is one named data container.
type Struct struct {
	Name   string
	Kind   Kind
	Dims   []int
	Fill   Value
	Aux    bool
	Labels *Labels
	Schema *Schema

	flat map[string]Value // scalar | array | grid | map
	root map[string]Value // nodes | graph
	// order is node creation order. Renderers use it for deterministic
	// tie-breaking; nothing depends on it being meaningful.
	order []string
}

// NewState returns an empty state with call pairing precomputed.
func NewState(t *Trace) *State {
	s := &State{
		Structs:   map[string]*Struct{},
		retToCall: map[int]int{},
	}
	var stack []int
	for i, e := range t.Events {
		switch e.T {
		case Call:
			stack = append(stack, i)
		case Ret:
			if n := len(stack); n > 0 {
				s.retToCall[i] = stack[n-1]
				stack = stack[:n-1]
			} else {
				s.retToCall[i] = -1
			}
		}
	}
	return s
}

// Names returns struct names in creation order.
func (s *State) Names() []string { return s.order }

// Get reads through to Fill for absent addresses.
func (s *State) Get(name string, at Path) Value {
	st := s.Structs[name]
	if st == nil {
		return nil
	}
	return st.Get(at)
}

func (st *Struct) Get(at Path) Value {
	if st.Kind.IsNodeKind() {
		return st.getNested(at)
	}
	if v, ok := st.flat[at.Join()]; ok {
		return v
	}
	return st.Fill
}

func (st *Struct) getNested(at Path) Value {
	if len(at) == 0 {
		return st.Fill
	}
	cur, ok := st.root[at[0].String()]
	if !ok {
		return st.Fill
	}
	for _, seg := range at[1:] {
		switch c := cur.(type) {
		case Record:
			v, ok := c[seg.String()]
			if !ok {
				return st.Fill
			}
			cur = v
		case Tuple:
			if !seg.IsIdx || seg.I < 0 || seg.I >= len(c) {
				return st.Fill
			}
			cur = c[seg.I]
		default:
			return st.Fill
		}
	}
	return cur
}

// Set writes v at at. The value is normalized and cloned, so state never
// aliases an event's payload -- without the clone, unapplying a node creation
// would mutate the event that created it.
func (st *Struct) Set(at Path, v Value) {
	v = Clone(Normalize(v))
	if !st.Kind.IsNodeKind() {
		st.flat[at.Join()] = v
		return
	}
	if len(at) == 0 {
		return
	}
	head := at[0].String()
	if len(at) == 1 {
		if _, seen := st.root[head]; !seen {
			st.order = append(st.order, head)
		}
		st.root[head] = v
		return
	}
	// Descend, creating Records on demand. A missing intermediate is an
	// algorithm bug that V4 will have already flagged; creating it here keeps
	// the player total rather than panicking mid-demo.
	container, ok := st.root[head]
	if !ok || container == nil {
		container = Record{}
		if _, seen := st.root[head]; !seen {
			st.order = append(st.order, head)
		}
		st.root[head] = container
	}
	for i := 1; i < len(at)-1; i++ {
		seg := at[i].String()
		rec, ok := container.(Record)
		if !ok {
			rec = Record{}
			st.assign(at[:i], rec)
			container = rec
		}
		next, ok := rec[seg]
		if !ok || next == nil {
			next = Record{}
			rec[seg] = next
		}
		container = next
	}
	if rec, ok := container.(Record); ok {
		rec[at[len(at)-1].String()] = v
	}
}

func (st *Struct) assign(at Path, v Value) {
	if len(at) == 1 {
		st.root[at[0].String()] = v
	}
}

// Exists reports whether a node slot currently holds a non-nil value.
func (st *Struct) Exists(id string) bool {
	v, ok := st.root[id]
	return ok && v != nil
}

// NodeIDs returns node slots in creation order, excluding reserved namespaces.
func (st *Struct) NodeIDs() []string {
	out := make([]string, 0, len(st.order))
	for _, id := range st.order {
		if id == NSRefs || id == NSEdges {
			continue
		}
		out = append(out, id)
	}
	return out
}

// Flat exposes the flat cell map for renderers and tests. Read only.
func (st *Struct) Flat() map[string]Value { return st.flat }

// Root exposes the node map for renderers and tests. Read only.
func (st *Struct) Root() map[string]Value { return st.root }

// ---------------------------------------------------------------------------
// Applying events
// ---------------------------------------------------------------------------

// ApplyForward applies one event. idx is the event's index in Trace.Events,
// needed so a call can be identified by position (calls carry no id).
//
// changed, when non-nil, receives the address keys this event touched. It is
// mutated in place; nothing here allocates a new set.
func (s *State) ApplyForward(idx int, e *Event, changed map[string]bool) error {
	switch e.T {
	case Init:
		if _, dup := s.Structs[e.S]; dup {
			return fmt.Errorf("init: structure %q already exists", e.S)
		}
		st := &Struct{
			Name: e.S, Kind: e.Kind, Dims: e.Dims, Fill: Normalize(e.Fill),
			Aux: e.Aux, Labels: e.Labels, Schema: e.Schema,
		}
		if e.Kind.IsNodeKind() {
			st.root = map[string]Value{}
		} else {
			st.flat = map[string]Value{}
		}
		s.Structs[e.S] = st
		s.order = append(s.order, e.S)
		if changed != nil {
			changed[e.S+" "] = true
		}
	case Set:
		st := s.Structs[e.S]
		if st == nil {
			return fmt.Errorf("set: unknown structure %q", e.S)
		}
		st.Set(e.At, e.To)
		if changed != nil {
			changed[e.At.KeyWith(e.S)] = true
		}
	case Call:
		s.Stack = append(s.Stack, idx)
	case Ret:
		if n := len(s.Stack); n > 0 {
			s.Stack = s.Stack[:n-1]
		}
	}
	return nil
}

// ApplyBackward undoes one event using only that event (invariant I1).
func (s *State) ApplyBackward(idx int, e *Event, changed map[string]bool) error {
	switch e.T {
	case Init:
		delete(s.Structs, e.S)
		if n := len(s.order); n > 0 && s.order[n-1] == e.S {
			s.order = s.order[:n-1]
		} else {
			for i, n := range s.order {
				if n == e.S {
					s.order = append(s.order[:i], s.order[i+1:]...)
					break
				}
			}
		}
		if changed != nil {
			changed[e.S+" "] = true
		}
	case Set:
		st := s.Structs[e.S]
		if st == nil {
			return fmt.Errorf("set: unknown structure %q", e.S)
		}
		st.Set(e.At, e.From)
		if changed != nil {
			changed[e.At.KeyWith(e.S)] = true
		}
	case Call:
		if n := len(s.Stack); n > 0 {
			s.Stack = s.Stack[:n-1]
		}
	case Ret:
		if c, ok := s.retToCall[idx]; ok && c >= 0 {
			s.Stack = append(s.Stack, c)
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

// Addresses returns every live address key with its canonical value, sorted.
// Values equal to the structure's Fill are SKIPPED -- that is what makes sparse
// and dense storage hash identically, and what makes a rewind land back on the
// initial hash without any special casing.
func (s *State) Addresses() []string {
	names := make([]string, 0, len(s.Structs))
	for n := range s.Structs {
		names = append(names, n)
	}
	sort.Strings(names)

	var out []string
	for _, n := range names {
		st := s.Structs[n]
		if st.Kind.IsNodeKind() {
			keys := make([]string, 0, len(st.root))
			for k := range st.root {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			for _, k := range keys {
				out = appendLeaves(out, st, n+" "+k, st.root[k])
			}
		} else {
			keys := make([]string, 0, len(st.flat))
			for k := range st.flat {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			for _, k := range keys {
				v := st.flat[k]
				if Equal(v, st.Fill) {
					continue
				}
				out = append(out, n+" "+k+"="+Canon(v))
			}
		}
	}
	return out
}

func appendLeaves(out []string, st *Struct, prefix string, v Value) []string {
	if Equal(v, st.Fill) {
		return out
	}
	switch t := v.(type) {
	case Record:
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			out = appendLeaves(out, st, prefix+"/"+k, t[k])
		}
		return out
	}
	return append(out, prefix+"="+Canon(v))
}

// StateHash is FNV-1a over the sorted address list plus the call stack depth.
//
// The JS implementation must produce the same 64-bit value for the same state.
// scripts/conformance.sh diffs the two, step by step, on every golden trace.
func (s *State) Hash() uint64 {
	const (
		offset64 = 14695981039346656037
		prime64  = 1099511628211
	)
	h := uint64(offset64)
	write := func(str string) {
		for i := 0; i < len(str); i++ {
			h ^= uint64(str[i])
			h *= prime64
		}
		h ^= 0
		h *= prime64
	}
	for _, a := range s.Addresses() {
		write(a)
	}
	write("#stack")
	for _, f := range s.Stack {
		write(fmt.Sprintf("%d", f))
	}
	return h
}
