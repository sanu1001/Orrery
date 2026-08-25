// Package tracer is the recording API that algorithms write against.
//
// Design goal: instrumenting an algorithm should cost roughly ONE extra chained
// call per write, and the algorithm should still read as itself. If a new
// algorithm needs more than that, this API is wrong -- not the algorithm.
//
//	dp := tr.Grid("dp", n, m, 0)
//	dp.Set(i, j, best).
//	   Because("max(dp[%d][%d], dp[%d][%d])", i-1, j, i, j-1).
//	   From(dp.Cell(i-1, j), dp.Cell(i, j-1))
package tracer

import (
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
	"time"

	"github.com/sanu1001/orrery/internal/trace"
)

const (
	DefaultMaxEvents   = 200_000
	DefaultMaxBytes    = 8 << 20
	deadlineCheckEvery = 1024 // time.Now() is the expensive part
)

var (
	ErrEventCap = errors.New("trace: event cap reached")
	ErrByteCap  = errors.New("trace: byte cap reached")
	ErrDeadline = errors.New("trace: deadline exceeded")
)

type Config struct {
	Algo      string
	Title     string
	Lang      string // defaults to "go"
	Input     any
	Seed      int64
	MaxEvents int          // 0 -> DefaultMaxEvents
	MaxBytes  int          // 0 -> DefaultMaxBytes
	Deadline  time.Time    // zero -> no wall clock cap
	Source    trace.Source // usually from //go:embed
}

// Tracer accumulates events and mirrors the resulting state.
//
// The mirror is a trace.State that every emitted event is applied to
// immediately. That is what lets Set compute `from` without the algorithm
// supplying it, and it makes validator check V4 true BY CONSTRUCTION rather
// than by discipline.
type Tracer struct {
	cfg    Config
	events []trace.Event
	views  []trace.View
	state  *trace.State

	nextGroup int
	curGroup  int
	nextNode  int

	stopped bool
	err     error
	srcBase string
}

func New(cfg Config) *Tracer {
	if cfg.MaxEvents == 0 {
		cfg.MaxEvents = DefaultMaxEvents
	}
	if cfg.MaxBytes == 0 {
		cfg.MaxBytes = DefaultMaxBytes
	}
	if cfg.Lang == "" {
		cfg.Lang = "go"
	}
	t := &Tracer{cfg: cfg, state: trace.NewState(&trace.Trace{})}
	if cfg.Source.Path != "" {
		t.srcBase = filepath.Base(cfg.Source.Path)
	}
	return t
}

// Err reports which cap fired, if any.
//
// Algorithms are NOT required to check it: once a cap fires, every subsequent
// Set is a no-op returning a dummy *Ev, so chained calls never panic. Long
// loops should check it, but correctness does not depend on them doing so.
func (t *Tracer) Err() error { return t.err }

// Stopped reports whether recording has halted.
func (t *Tracer) Stopped() bool { return t.stopped }

// EventCount is the number of events recorded so far.
func (t *Tracer) EventCount() int { return len(t.events) }

// Trace finalises and returns the trace. Valid and playable even when
// truncated.
func (t *Tracer) Trace() *trace.Trace {
	steps := trace.BuildSteps(t.events, 0)
	structs := 0
	for i := range t.events {
		if t.events[i].T == trace.Init {
			structs++
		}
	}
	var input json.RawMessage
	if t.cfg.Input != nil {
		if b, err := json.Marshal(t.cfg.Input); err == nil {
			input = b
		}
	}
	out := &trace.Trace{
		V: trace.Version,
		Meta: trace.Meta{
			Algo: t.cfg.Algo, Title: t.cfg.Title, Lang: t.cfg.Lang,
			Input: input, Seed: t.cfg.Seed,
			Views:  t.views,
			Counts: trace.Counts{Events: len(t.events), Steps: len(steps), Structs: structs},
			Engine: trace.Engine,
		},
		Events: t.events,
	}
	if t.cfg.Source.Text != "" {
		src := t.cfg.Source
		if src.FirstLine == 0 {
			src.FirstLine = 1
		}
		out.Meta.Source = &src
	}
	if t.err != nil {
		out.Meta.Truncated = true
		switch {
		case errors.Is(t.err, ErrEventCap):
			out.Meta.TruncatedReason = "events"
		case errors.Is(t.err, ErrByteCap):
			out.Meta.TruncatedReason = "bytes"
		case errors.Is(t.err, ErrDeadline):
			out.Meta.TruncatedReason = "wall"
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

// deadEv is returned once recording has stopped, so chained calls on a
// no-op write neither panic nor allocate.
var deadEv = &Ev{i: -1}

// emit appends an event, applies it to the mirror, and returns a chaining
// handle. skip is the number of stack frames between the user's call and here.
//
// runtime.Caller costs roughly 100ns. Over a full 200k-event trace that is
// about 20ms, once, offline. In exchange every built-in algorithm gets correct
// code-pane highlighting with ZERO annotation burden. Highest value-per-line
// decision in this package.
//
// HAZARD: skip is hand-counted. Adding a helper layer between a public Set and
// here silently shifts every line number by a function, and the symptom is a
// code pane that highlights the wrong line -- which reads as a rendering bug,
// not a tracer bug. TestCallerLines pins it.
func (t *Tracer) emit(skip int, e trace.Event) *Ev {
	if t.stopped {
		return deadEv
	}
	if len(t.events) >= t.cfg.MaxEvents {
		t.stop(ErrEventCap)
		return deadEv
	}
	if !t.cfg.Deadline.IsZero() && len(t.events)%deadlineCheckEvery == 0 {
		if time.Now().After(t.cfg.Deadline) {
			t.stop(ErrDeadline)
			return deadEv
		}
	}

	if _, file, line, ok := runtime.Caller(skip); ok {
		// Only trust the line when it came from the file the code pane shows.
		// A line number pointing into a different file is worse than none.
		if t.srcBase == "" || filepath.Base(file) == t.srcBase {
			e.Ln = line
		}
	}
	e.G = t.curGroup

	idx := len(t.events)
	t.events = append(t.events, e)
	if err := t.state.ApplyForward(idx, &t.events[idx], nil); err != nil {
		// A structural error here means the algorithm is doing something the
		// format cannot express. Fail loudly at generation time rather than
		// shipping a trace that will not replay.
		panic(fmt.Sprintf("tracer: %v (event %d)", err, idx))
	}
	return &Ev{t: t, i: idx}
}

func (t *Tracer) stop(err error) {
	if t.err == nil {
		t.err = err
	}
	t.stopped = true
}

// Group makes everything written inside f a single step.
//
// The returned *Ev points at the FIRST event of the group, so a Note attaches
// to the step as a whole. Nested groups flatten -- outermost wins. That is
// deliberate: nested step granularity is a feature nobody asked for and it
// would turn the step index into a tree. ADR 0020.
func (t *Tracer) Group(f func()) *Ev {
	if t.curGroup != 0 { // already inside a group: flatten
		start := len(t.events)
		f()
		if start < len(t.events) {
			return &Ev{t: t, i: start}
		}
		return deadEv
	}
	t.nextGroup++
	t.curGroup = t.nextGroup
	start := len(t.events)
	f()
	t.curGroup = 0
	if start < len(t.events) {
		return &Ev{t: t, i: start}
	}
	return deadEv
}

// Call records entering a function.
func (t *Tracer) Call(fn string, args ...trace.Arg) *Ev {
	return t.emit(2, trace.Event{T: trace.Call, Fn: fn, Args: args})
}

// Return records leaving a function.
func (t *Tracer) Return(v trace.Value) *Ev {
	return t.emit(2, trace.Event{T: trace.Ret, V: trace.Normalize(v)})
}

// A builds one named call argument.
func A(name string, v trace.Value) trace.Arg {
	return trace.Arg{N: name, V: trace.Normalize(v)}
}

// View declares a render hint. Data, not code -- ADR 0012.
//
//	tr.View("grid", "dp", 0)
//	tr.View("recursionTree", "$calls", 1, Title("Call tree"), Opt("memoOf", "dp"))
func (t *Tracer) View(family, structName string, pane any, opts ...ViewOpt) {
	v := trace.View{Family: family, S: structName, Pane: pane}
	for _, o := range opts {
		o(&v)
	}
	t.views = append(t.views, v)
}

// ViewOpt configures a view hint.
type ViewOpt func(*trace.View)

func Title(s string) ViewOpt {
	return func(v *trace.View) { v.Title = s }
}

// CallerLine reports the source line `skip` frames up, or 0 when that frame is
// not in the algorithm's own embedded source.
//
// Exported for helpers that live OUTSIDE the algorithm file -- an input parser,
// say. Without it such a helper stamps every event with a line in its own file,
// the file-match guard suppresses it, and the code pane highlights nothing.
// Array.Fill does exactly this internally; this is that, reachable.
func (t *Tracer) CallerLine(skip int) int {
	if _, file, line, ok := runtime.Caller(skip); ok && filepath.Base(file) == t.srcBase {
		return line
	}
	return 0
}

// StartHere marks the CURRENT position as the end of the construction
// prologue, so the player opens there rather than at event 0.
//
// Called after the input structure is built and before the algorithm runs,
// which is why it takes the tracer rather than a number: hand-counting events
// is the kind of thing that silently rots the first time a line is added to the
// parser. RENDERERS/TREE.md 2.3.
func StartHere(t *Tracer) ViewOpt {
	n := len(t.events)
	return func(v *trace.View) { v.StartEvent = n }
}

func Opt(key string, val any) ViewOpt {
	return func(v *trace.View) {
		if v.Options == nil {
			v.Options = map[string]any{}
		}
		v.Options[key] = val
	}
}

// nodeID mints the next node id. Ids are minted in creation order (n0, n1, ...)
// so that layout tie-breaking and force-layout seeding are deterministic.
func (t *Tracer) nodeID() string {
	id := fmt.Sprintf("n%d", t.nextNode)
	t.nextNode++
	return id
}

func (t *Tracer) declare(e trace.Event) {
	t.emit(3, e)
}
