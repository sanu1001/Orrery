// Package algos is the registry of built-in algorithms.
//
// Adding an algorithm is: write one file, //go:embed it, call Register in
// init(). The registry drives the picker, generates the input form, and feeds
// the code pane -- so NO FRONTEND CHANGE IS NEEDED. That property is worth
// protecting; it is what makes "twelve algorithms" cheap rather than twelve
// times as expensive as one.
package algos

import (
	"fmt"
	"sort"
	"sync"

	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

// Spec describes one algorithm.
type Spec struct {
	ID     string // stable; appears in URLs and cache keys. [a-z0-9_-]+
	Title  string
	Family string // "Dynamic programming" -- UI grouping only
	Blurb  string // one sentence for the picker

	// Inputs drives the generated input form AND the server-side bounds check.
	// Those bounds are the security boundary for Stage A: everything downstream
	// trusts them. A missing Max on a dimension is a memory-exhaustion bug.
	Inputs   []InputSpec
	Defaults Args

	// Source is the algorithm's own file, via //go:embed. Shown in the code
	// pane; every event's Ln indexes into it.
	Source trace.Source

	Run  func(*tracer.Tracer, Args) error
	Tags []string

	// Complexity is the DECLARED growth, expressed in the swept input with every
	// other input held at its default. That qualifier matters: sweeping one
	// dimension of a 2-D DP measures O(n), not O(n*m), and a claim of O(n*m)
	// would be textbook-correct and disagree with every measurement.
	//
	// It is a claim the app CHECKS rather than displays. C3 fits a curve to the
	// measured counts and shows the two beside each other, which is only
	// interesting because they can disagree.
	Complexity string

	// Sweep names the inputs that grow with n. Naming more than one scales them
	// together, which is what lets LCS measure as O(n^2) instead of as O(n) with
	// its other string pinned.
	//
	// Declared rather than inferred: the first int input of `binary` is the
	// search target and of `list-reverse` is a boolean flag. Guessing would be
	// silently wrong for both, and wrong in a way that produces a plausible
	// curve rather than an error.
	Sweep []string
}

// SweepArgs builds the inputs for a run "of size n": every input named in
// Spec.Sweep scales to n, everything else keeps its default.
//
// Values are DETERMINISTIC -- the same n always produces the same input, on
// every machine and every run -- so a complexity curve is reproducible and so
// is any trace generated from one. ADR 0007.
func SweepArgs(s Spec, n int) (Args, bool) {
	if len(s.Sweep) == 0 {
		return nil, false
	}
	out := Args{}
	for k, v := range s.Defaults {
		out[k] = v
	}
	for i, name := range s.Sweep {
		f := s.input(name)
		if f == nil {
			return nil, false
		}
		switch f.Kind {
		case "int":
			out[name] = n
		case "intList":
			out[name] = scramble(n)
		case "string":
			out[name] = word(n, i)
		case "tree":
			toks := make([]any, n)
			for j := range toks {
				toks[j] = j + 1
			}
			out[name] = toks
		default:
			return nil, false
		}
	}
	return out, true
}

// SweepRange is the span of n worth measuring: wide enough for a curve to have
// a shape, and clamped to the per-algorithm input bounds, which are the
// security boundary everything downstream trusts.
func SweepRange(s Spec) (lo, hi int, ok bool) {
	if len(s.Sweep) == 0 {
		return 0, 0, false
	}
	lo, hi = 1, 1<<30
	for _, name := range s.Sweep {
		f := s.input(name)
		if f == nil || f.Max <= 0 {
			return 0, 0, false
		}
		if f.Min > lo {
			lo = f.Min
		}
		if f.Max < hi {
			hi = f.Max
		}
	}
	// One point cannot have a shape, and two fit anything perfectly.
	if hi-lo < 2 {
		return 0, 0, false
	}
	return lo, hi, true
}

func (s Spec) input(name string) *InputSpec {
	for i := range s.Inputs {
		if s.Inputs[i].Name == name {
			return &s.Inputs[i]
		}
	}
	return nil
}

// scramble is a deterministic disordered list of length n.
//
// Not sorted, because a sorting algorithm handed sorted input measures its best
// case -- bubble sort's early exit makes that O(n), and the curve would claim
// something true but useless. Not randomised either: the same n has to give the
// same answer on every machine, or a measured curve is not reproducible and the
// comparison against the declared one means nothing. ADR 0007.
//
// A fixed LCG rather than an index shuffle. The first version swapped i with a
// computed j for every i, and for some n those swaps cancelled and left the
// list nearly sorted -- so bubble sort measured 121 events at n=11 and 32 at
// n=12. Noise from the INPUT, wearing the shape of a property of the algorithm.
func scramble(n int) []int {
	out := make([]int, n)
	seed := uint32(2463534242)
	for i := range out {
		seed = seed*1664525 + 1013904223
		out[i] = int(seed>>16) % (4*n + 7)
	}
	return out
}

// word builds a string over a small alphabet so that two swept strings share
// enough characters for an alignment DP to do real work. `k` offsets the
// pattern, so sweeping `a` and `b` together does not hand LCS two identical
// strings and a degenerate diagonal.
func word(n, k int) string {
	const alpha = "ABCDGT"
	b := make([]byte, n)
	for i := range b {
		b[i] = alpha[(i*5+2+k*3)%len(alpha)]
	}
	return string(b)
}

// InputSpec is one field of the generated form.
type InputSpec struct {
	Name    string `json:"name"`
	Kind    string `json:"kind"` // int | string | intList | tree
	Min     int    `json:"min,omitempty"`
	Max     int    `json:"max,omitempty"`
	Default any    `json:"default,omitempty"`
	Help    string `json:"help,omitempty"`

	// Notation disambiguates tree input: "leetcode" (level order, children of
	// nulls omitted) or "heap" (perfect-tree indexing). NEVER guessed --
	// the two conventions produce different trees from the same tokens.
	Notation string `json:"notation,omitempty"`
}

// Args are the resolved inputs.
type Args map[string]any

var (
	mu    sync.RWMutex
	specs = map[string]Spec{}
)

// Register panics on a duplicate id. A duplicate is always a copy-paste bug,
// and failing at init is better than silently serving the wrong algorithm.
func Register(s Spec) {
	mu.Lock()
	defer mu.Unlock()
	if _, dup := specs[s.ID]; dup {
		panic("algos: duplicate algorithm id " + s.ID)
	}
	specs[s.ID] = s
}

func Lookup(id string) (Spec, bool) {
	mu.RLock()
	defer mu.RUnlock()
	s, ok := specs[id]
	return s, ok
}

// All returns every spec sorted by family then title -- the order the picker
// renders, so the picker needs no sorting logic of its own.
func All() []Spec {
	mu.RLock()
	defer mu.RUnlock()
	out := make([]Spec, 0, len(specs))
	for _, s := range specs {
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Family != out[j].Family {
			return out[i].Family < out[j].Family
		}
		return out[i].Title < out[j].Title
	})
	return out
}

// Resolve merges user-supplied args over the defaults and validates every field
// against its InputSpec.
//
// THIS IS THE SECURITY BOUNDARY for Stage A. Everything downstream trusts these
// bounds; a missing Max on a grid dimension is a memory-exhaustion bug and the
// only realistic way to take the server down before Stage B exists.
func (s Spec) Resolve(in Args) (Args, error) {
	out := Args{}
	for k, v := range s.Defaults {
		out[k] = v
	}
	for _, f := range s.Inputs {
		v, ok := in[f.Name]
		if !ok || v == nil {
			if _, has := out[f.Name]; !has {
				out[f.Name] = f.Default
			}
			continue
		}
		cv, err := coerce(f, v)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", f.Name, err)
		}
		out[f.Name] = cv
	}
	return out, nil
}

func coerce(f InputSpec, v any) (any, error) {
	switch f.Kind {
	case "int":
		n, err := toInt(v)
		if err != nil {
			return nil, err
		}
		if f.Max > 0 && (n < f.Min || n > f.Max) {
			return nil, fmt.Errorf("must be between %d and %d", f.Min, f.Max)
		}
		return n, nil
	case "string":
		s, ok := v.(string)
		if !ok {
			return nil, fmt.Errorf("must be a string")
		}
		if f.Max > 0 && len(s) > f.Max {
			return nil, fmt.Errorf("must be at most %d characters", f.Max)
		}
		return s, nil
	case "intList":
		list, err := toIntList(v)
		if err != nil {
			return nil, err
		}
		if f.Max > 0 && len(list) > f.Max {
			return nil, fmt.Errorf("must have at most %d elements", f.Max)
		}
		return list, nil
	case "tree":
		toks, err := toTokens(v)
		if err != nil {
			return nil, err
		}
		if f.Max > 0 && len(toks) > f.Max {
			return nil, fmt.Errorf("must have at most %d elements", f.Max)
		}
		return toks, nil
	}
	return v, nil
}

func toInt(v any) (int, error) {
	switch t := v.(type) {
	case int:
		return t, nil
	case int64:
		return int(t), nil
	case float64:
		return int(t), nil
	}
	return 0, fmt.Errorf("must be a number")
}

// toTokens keeps LeetCode level-order tokens as []any so that a null survives.
//
// A null is a VALUE in that notation -- "no node here" -- not a missing token.
// Coercing the list to []int drops them, and [1,null,2] silently becomes
// [1,2], which is a different tree: 2 goes from being the right child of 1 to
// being its left child. RENDERERS/TREE.md 2.
func toTokens(v any) ([]any, error) {
	switch t := v.(type) {
	case []any:
		out := make([]any, len(t))
		for i, e := range t {
			if e == nil {
				continue // out[i] stays nil, which is the point
			}
			n, err := toInt(e)
			if err != nil {
				return nil, err
			}
			out[i] = n
		}
		return out, nil
	case []int:
		out := make([]any, len(t))
		for i, e := range t {
			out[i] = e
		}
		return out, nil
	}
	return nil, fmt.Errorf("must be a list of numbers and nulls")
}

func toIntList(v any) ([]int, error) {
	switch t := v.(type) {
	case []int:
		return t, nil
	case []any:
		out := make([]int, len(t))
		for i, e := range t {
			n, err := toInt(e)
			if err != nil {
				return nil, err
			}
			out[i] = n
		}
		return out, nil
	}
	return nil, fmt.Errorf("must be a list of numbers")
}

// ---------------------------------------------------------------------------
// Typed accessors
// ---------------------------------------------------------------------------
//
// These panic with the field name on a type mismatch. A bare assertion produces
// "interface conversion: interface {} is string, not int", which does not say
// WHICH field -- and an algorithm with six inputs makes that a real search.

func (a Args) Str(k string) string {
	v, ok := a[k].(string)
	if !ok {
		panic(fmt.Sprintf("algos: arg %q is %T, want string", k, a[k]))
	}
	return v
}

func (a Args) Int(k string) int {
	n, err := toInt(a[k])
	if err != nil {
		panic(fmt.Sprintf("algos: arg %q is %T, want int", k, a[k]))
	}
	return n
}

func (a Args) Ints(k string) []int {
	l, err := toIntList(a[k])
	if err != nil {
		panic(fmt.Sprintf("algos: arg %q is %T, want []int", k, a[k]))
	}
	return l
}

// Tokens reads a "tree" input: level-order tokens where a nil element means
// "no node here". Elements are int or nil, never anything else.
func (a Args) Tokens(k string) []any {
	t, err := toTokens(a[k])
	if err != nil {
		panic(fmt.Sprintf("algos: arg %q is %T, want a list of numbers and nulls", k, a[k]))
	}
	return t
}
