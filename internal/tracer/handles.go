package tracer

import (
	"fmt"
	"path/filepath"
	"runtime"

	"github.com/sanu1001/orrery/internal/trace"
)

// ---------------------------------------------------------------------------
// Scalar
// ---------------------------------------------------------------------------

// Scalar is a single value: a loop index, a pivot, a running total.
//
// Scalars marked Aux are CURSOR STRUCTURES -- the mechanism that makes a read
// visible by promoting it to a write. Without them, binary search is a
// three-comparison, zero-write algorithm and its trace is empty. See
// ARCHITECTURE.md 6.1 and FLAWS.md 1.
type Scalar struct {
	t    *Tracer
	name string
}

func (t *Tracer) Scalar(name string, init trace.Value) *Scalar {
	t.emit(2, trace.Event{T: trace.Init, S: name, Kind: trace.KindScalar, Fill: trace.Normalize(init)})
	return &Scalar{t: t, name: name}
}

func (s *Scalar) Aux() *Scalar { markAux(s.t, s.name); return s }

func (s *Scalar) Set(v trace.Value) *Ev {
	return s.t.emit(2, trace.Event{
		T: trace.Set, S: s.name, At: trace.Path{},
		From: s.t.state.Get(s.name, trace.Path{}), To: trace.Normalize(v),
	})
}

func (s *Scalar) V() trace.Value { return s.t.state.Get(s.name, trace.Path{}) }

func (s *Scalar) Int() int { return toInt(s.V(), s.name) }

func (s *Scalar) Cell() Cell {
	return Cell{S: s.name, At: trace.Path{}, V: s.V()}
}

// ---------------------------------------------------------------------------
// Array
// ---------------------------------------------------------------------------

type Array struct {
	t    *Tracer
	name string
	n    int
}

func (t *Tracer) Array(name string, n int, fill trace.Value) *Array {
	t.emit(2, trace.Event{T: trace.Init, S: name, Kind: trace.KindArray,
		Dims: []int{n}, Fill: trace.Normalize(fill)})
	return &Array{t: t, name: name, n: n}
}

func (a *Array) Aux() *Array { markAux(a.t, a.name); return a }

func (a *Array) Len() int { return a.n }

func (a *Array) Set(i int, v trace.Value) *Ev {
	at := trace.Path{trace.Idx(i)}
	return a.t.emit(2, trace.Event{
		T: trace.Set, S: a.name, At: at,
		From: a.t.state.Get(a.name, at), To: trace.Normalize(v),
	})
}

func (a *Array) At(i int) trace.Value { return a.t.state.Get(a.name, trace.Path{trace.Idx(i)}) }
func (a *Array) Int(i int) int        { return toInt(a.At(i), fmt.Sprintf("%s[%d]", a.name, i)) }
func (a *Array) Num(i int) float64    { return toNum(a.At(i), fmt.Sprintf("%s[%d]", a.name, i)) }

func (a *Array) Cell(i int) Cell {
	return Cell{S: a.name, At: trace.Path{trace.Idx(i)}, V: a.At(i)}
}

// Fill writes every element in one group, so loading an input is a single step.
//
// The caller's line is captured here and stamped on every element write.
// Without that, the writes originate inside this file, the tracer's file-match
// guard suppresses their line numbers, and the input step highlights nothing in
// the code pane -- a small hole that TestCallerLines exists to catch.
func (a *Array) Fill(vals []int) *Ev {
	ln := 0
	if _, file, line, ok := runtime.Caller(1); ok && filepath.Base(file) == a.t.srcBase {
		ln = line
	}
	return a.t.Group(func() {
		for i, v := range vals {
			if i < a.n {
				a.Set(i, v).Line(ln)
			}
		}
	}).Note("input")
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

type Grid struct {
	t          *Tracer
	name       string
	rows, cols int
}

func (t *Tracer) Grid(name string, rows, cols int, fill trace.Value) *Grid {
	t.emit(2, trace.Event{T: trace.Init, S: name, Kind: trace.KindGrid,
		Dims: []int{rows, cols}, Fill: trace.Normalize(fill)})
	return &Grid{t: t, name: name, rows: rows, cols: cols}
}

func (g *Grid) Aux() *Grid { markAux(g.t, g.name); return g }

// Labels sets cosmetic row and column headers. Chained immediately after
// construction, so it patches the init event that was just emitted.
func (g *Grid) Labels(rows, cols []string) *Grid {
	for i := len(g.t.events) - 1; i >= 0; i-- {
		e := &g.t.events[i]
		if e.T == trace.Init && e.S == g.name {
			e.Labels = &trace.Labels{Rows: rows, Cols: cols}
			// The mirror holds a pointer to the same struct metadata, so patch it.
			if st := g.t.state.Structs[g.name]; st != nil {
				st.Labels = e.Labels
			}
			break
		}
	}
	return g
}

func (g *Grid) Rows() int { return g.rows }
func (g *Grid) Cols() int { return g.cols }

func (g *Grid) Set(r, c int, v trace.Value) *Ev {
	at := trace.Path{trace.Idx(r), trace.Idx(c)}
	return g.t.emit(2, trace.Event{
		T: trace.Set, S: g.name, At: at,
		From: g.t.state.Get(g.name, at), To: trace.Normalize(v),
	})
}

func (g *Grid) At(r, c int) trace.Value {
	return g.t.state.Get(g.name, trace.Path{trace.Idx(r), trace.Idx(c)})
}

func (g *Grid) Int(r, c int) int {
	return toInt(g.At(r, c), fmt.Sprintf("%s[%d][%d]", g.name, r, c))
}

func (g *Grid) Num(r, c int) float64 {
	return toNum(g.At(r, c), fmt.Sprintf("%s[%d][%d]", g.name, r, c))
}

func (g *Grid) Cell(r, c int) Cell {
	return Cell{S: g.name, At: trace.Path{trace.Idx(r), trace.Idx(c)}, V: g.At(r, c)}
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

type Map struct {
	t    *Tracer
	name string
}

func (t *Tracer) Map(name string, fill trace.Value) *Map {
	t.emit(2, trace.Event{T: trace.Init, S: name, Kind: trace.KindMap, Fill: trace.Normalize(fill)})
	return &Map{t: t, name: name}
}

func (m *Map) Aux() *Map { markAux(m.t, m.name); return m }

func (m *Map) Set(key string, v trace.Value) *Ev {
	at := trace.Path{trace.Key(key)}
	return m.t.emit(2, trace.Event{
		T: trace.Set, S: m.name, At: at,
		From: m.t.state.Get(m.name, at), To: trace.Normalize(v),
	})
}

func (m *Map) At(key string) trace.Value { return m.t.state.Get(m.name, trace.Path{trace.Key(key)}) }

func (m *Map) Has(key string) bool {
	_, ok := m.t.state.Structs[m.name].Flat()[key]
	return ok
}

func (m *Map) Int(key string) int { return toInt(m.At(key), m.name+"["+key+"]") }

func (m *Map) Cell(key string) Cell {
	return Cell{S: m.name, At: trace.Path{trace.Key(key)}, V: m.At(key)}
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

// markAux patches the init event that was just emitted. Aux is load-bearing
// metadata, not documentation: it is the precondition that makes detail-level
// filtering sound (ADR 0016), and validator check V8 enforces it.
func markAux(t *Tracer, name string) {
	for i := len(t.events) - 1; i >= 0; i-- {
		e := &t.events[i]
		if e.T == trace.Init && e.S == name {
			e.Aux = true
			if st := t.state.Structs[name]; st != nil {
				st.Aux = true
			}
			return
		}
	}
}

// toInt and toNum are typed accessors whose panic names the address. Bare type
// assertions on trace.Value produce "interface conversion: interface {} is
// string, not float64", which tells you nothing about WHICH cell. These save
// roughly forty assertions across the algorithm package and every one of their
// panic messages is actionable.
func toInt(v trace.Value, what string) int {
	n, ok := trace.Num(v)
	if !ok {
		panic(fmt.Sprintf("tracer: %s holds %s, which is not a number", what, trace.Canon(v)))
	}
	return int(n)
}

func toNum(v trace.Value, what string) float64 {
	n, ok := trace.Num(v)
	if !ok {
		panic(fmt.Sprintf("tracer: %s holds %s, which is not a number", what, trace.Canon(v)))
	}
	return n
}
