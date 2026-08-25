package tracer

import (
	"fmt"

	"github.com/sanu1001/orrery/internal/trace"
)

// Ev is a handle to the event that was just appended, for chained annotation.
//
// Emit-then-annotate rather than build-then-commit, deliberately: a builder
// with a terminal .Do() is one forgotten call away from a silently missing
// step, and that bug is invisible until you play the trace. Emitting on Set
// means the write always lands; the chain only decorates.
//
// HAZARD: an *Ev is INVALIDATED by the next Set on the same tracer, because the
// event slice may reallocate. Never hold one across another write. The chaining
// style makes misuse unnatural, which is the only defence.
type Ev struct {
	t *Tracer
	i int // index into t.events; -1 means "no-op" (recording stopped)
}

func (e *Ev) ev() *trace.Event {
	if e == nil || e.i < 0 || e.t == nil || e.i >= len(e.t.events) {
		return nil
	}
	return &e.t.events[e.i]
}

// Because sets the display expression, e.g. "max(dp[3][4], dp[4][3])".
func (e *Ev) Because(format string, args ...any) *Ev {
	if ev := e.ev(); ev != nil {
		if len(args) == 0 {
			ev.Expr = format
		} else {
			ev.Expr = fmt.Sprintf(format, args...)
		}
	}
	return e
}

// From records provenance: the cells that were read, each carrying the value it
// held at read time. Snapshotting the value here rather than looking it up
// during replay is what makes explanations correct while stepping BACKWARD.
func (e *Ev) From(cells ...Cell) *Ev {
	if ev := e.ev(); ev != nil {
		for _, c := range cells {
			ev.Deps = append(ev.Deps, trace.Dep{S: c.S, At: c.At, V: c.V})
		}
	}
	return e
}

// Note replaces the "because" line in the explanation. For phase narration with
// no expression: "partitioning around pivot 7".
func (e *Ev) Note(format string, args ...any) *Ev {
	if ev := e.ev(); ev != nil {
		if len(args) == 0 {
			ev.Note = format
		} else {
			ev.Note = fmt.Sprintf(format, args...)
		}
	}
	return e
}

// Line overrides the automatically captured source line.
func (e *Ev) Line(n int) *Ev {
	if ev := e.ev(); ev != nil {
		ev.Ln = n
	}
	return e
}

// Lvl sets the detail level. Values > 0 are permitted ONLY on aux structures;
// validator check V8 enforces it, and ADR 0016 has the soundness proof.
func (e *Ev) Lvl(n int) *Ev {
	if ev := e.ev(); ev != nil {
		ev.Lvl = n
	}
	return e
}

// Cell is a read-reference: an address plus the value it held when read.
type Cell struct {
	S  string
	At trace.Path
	V  trace.Value
}
