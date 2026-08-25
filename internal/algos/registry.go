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
	case "intList", "tree":
		list, err := toIntList(v)
		if err != nil {
			return nil, err
		}
		if f.Max > 0 && len(list) > f.Max {
			return nil, fmt.Errorf("must have at most %d elements", f.Max)
		}
		return list, nil
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
