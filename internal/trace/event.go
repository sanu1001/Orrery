package trace

import (
	"encoding/json"
	"errors"
)

// EventType is a string on the wire so traces stay readable in a git diff.
type EventType string

const (
	Init EventType = "init"
	Set  EventType = "set"
	Call EventType = "call"
	Ret  EventType = "ret"
)

// Event is one entry in the trace.
//
// There are four event types and this is a single flat struct rather than an
// interface, because decoding into an interface requires a discriminated
// two-pass unmarshal per event -- measurably slower and much more code, for a
// benefit (field-level type safety) every consumer discards by switching on T
// anyway. See ENGINE.md 2.1.
//
// The cost is that most fields are irrelevant for most events. It is paid once,
// here, and the field groups are commented.
//
// Marshalling is per-type (see below) so the wire form carries exactly the
// fields that type uses. This matters for From/To/V/Fill in particular:
// `omitempty` would silently drop a legitimate `"from": 0`, and the validator's
// V4 check would then compare nil against 0 and fail. That is the whole reason
// this file has custom marshalling.
type Event struct {
	T EventType `json:"t"`

	// --- init + set ---
	S string `json:"s,omitempty"` // structure name

	// --- init ---
	Kind Kind  `json:"kind,omitempty"`
	Dims []int `json:"dims,omitempty"`
	Fill Value `json:"fill,omitempty"`
	// Aux marks a structure display-only: written to be seen, never read by the
	// algorithm. Load-bearing -- it is what makes Lvl sound. ADR 0016.
	Aux    bool    `json:"aux,omitempty"`
	Labels *Labels `json:"labels,omitempty"`
	Schema *Schema `json:"schema,omitempty"`

	// --- set ---
	At Path `json:"at,omitempty"`
	// From MUST equal the structure's current value at At. Validator check V4
	// verifies this by replaying. Backward stepping writes From.
	From Value `json:"from,omitempty"`
	To   Value `json:"to,omitempty"`

	// --- call ---
	Fn   string `json:"fn,omitempty"`
	Args []Arg  `json:"args,omitempty"`
	// NOTE: a call has no id field on purpose. Its identity is its index in
	// Trace.Events -- stable, gapless, monotonic and free.

	// --- ret ---
	V Value `json:"v,omitempty"`

	// --- provenance: set and ret ---
	Expr string `json:"expr,omitempty"`
	// Deps are the addresses read to produce this value, each carrying the value
	// it held AT READ TIME. Snapshotted, never looked up during replay -- that is
	// what makes explanations correct while rewinding. ADR 0005.
	Deps []Dep `json:"deps,omitempty"`

	// --- common ---
	Ln   int    `json:"ln,omitempty"`  // 1-based line in Meta.Source.Text
	G    int    `json:"g,omitempty"`   // group id; adjacent equal g>0 = one step
	Lvl  int    `json:"lvl,omitempty"` // detail level; >0 only on aux structures
	Note string `json:"note,omitempty"`
}

// Arg is one named argument of a call.
type Arg struct {
	N string `json:"n"`
	V Value  `json:"v"`
}

// Dep is one read: an address plus the value it held when it was read.
type Dep struct {
	S  string `json:"s"`
	At Path   `json:"at"`
	V  Value  `json:"v"`
}

// Labels are cosmetic row/column headers for a grid.
type Labels struct {
	Rows []string `json:"rows,omitempty"`
	Cols []string `json:"cols,omitempty"`
}

// ---------------------------------------------------------------------------
// Wire form
// ---------------------------------------------------------------------------

type initWire struct {
	T      EventType `json:"t"`
	S      string    `json:"s"`
	Kind   Kind      `json:"kind"`
	Dims   []int     `json:"dims,omitempty"`
	Fill   Value     `json:"fill"`
	Aux    bool      `json:"aux,omitempty"`
	Labels *Labels   `json:"labels,omitempty"`
	Schema *Schema   `json:"schema,omitempty"`
	Ln     int       `json:"ln,omitempty"`
	G      int       `json:"g,omitempty"`
	Lvl    int       `json:"lvl,omitempty"`
	Note   string    `json:"note,omitempty"`
}

type setWire struct {
	T    EventType `json:"t"`
	S    string    `json:"s"`
	At   Path      `json:"at"`
	From Value     `json:"from"`
	To   Value     `json:"to"`
	Expr string    `json:"expr,omitempty"`
	Deps []Dep     `json:"deps,omitempty"`
	Ln   int       `json:"ln,omitempty"`
	G    int       `json:"g,omitempty"`
	Lvl  int       `json:"lvl,omitempty"`
	Note string    `json:"note,omitempty"`
}

type callWire struct {
	T    EventType `json:"t"`
	Fn   string    `json:"fn"`
	Args []Arg     `json:"args,omitempty"`
	Ln   int       `json:"ln,omitempty"`
	G    int       `json:"g,omitempty"`
	Lvl  int       `json:"lvl,omitempty"`
	Note string    `json:"note,omitempty"`
}

type retWire struct {
	T    EventType `json:"t"`
	V    Value     `json:"v"`
	Expr string    `json:"expr,omitempty"`
	Deps []Dep     `json:"deps,omitempty"`
	Ln   int       `json:"ln,omitempty"`
	G    int       `json:"g,omitempty"`
	Lvl  int       `json:"lvl,omitempty"`
	Note string    `json:"note,omitempty"`
}

func (e Event) MarshalJSON() ([]byte, error) {
	switch e.T {
	case Init:
		return json.Marshal(initWire{Init, e.S, e.Kind, e.Dims, e.Fill, e.Aux,
			e.Labels, e.Schema, e.Ln, e.G, e.Lvl, e.Note})
	case Set:
		return json.Marshal(setWire{Set, e.S, e.At, e.From, e.To, e.Expr, e.Deps,
			e.Ln, e.G, e.Lvl, e.Note})
	case Call:
		return json.Marshal(callWire{Call, e.Fn, e.Args, e.Ln, e.G, e.Lvl, e.Note})
	case Ret:
		return json.Marshal(retWire{Ret, e.V, e.Expr, e.Deps, e.Ln, e.G, e.Lvl, e.Note})
	}
	return nil, errors.New("trace: unknown event type " + string(e.T))
}

// permissive is the single decode target. RawMessage on the Value fields is
// what distinguishes "absent" from "present and null" in one pass.
type permissive struct {
	T      EventType       `json:"t"`
	S      string          `json:"s"`
	Kind   Kind            `json:"kind"`
	Dims   []int           `json:"dims"`
	Fill   json.RawMessage `json:"fill"`
	Aux    bool            `json:"aux"`
	Labels *Labels         `json:"labels"`
	Schema *Schema         `json:"schema"`
	At     Path            `json:"at"`
	From   json.RawMessage `json:"from"`
	To     json.RawMessage `json:"to"`
	Fn     string          `json:"fn"`
	Args   []rawArg        `json:"args"`
	V      json.RawMessage `json:"v"`
	Expr   string          `json:"expr"`
	Deps   []rawDep        `json:"deps"`
	Ln     int             `json:"ln"`
	G      int             `json:"g"`
	Lvl    int             `json:"lvl"`
	Note   string          `json:"note"`
}

type rawArg struct {
	N string          `json:"n"`
	V json.RawMessage `json:"v"`
}

type rawDep struct {
	S  string          `json:"s"`
	At Path            `json:"at"`
	V  json.RawMessage `json:"v"`
}

func (e *Event) UnmarshalJSON(b []byte) error {
	var p permissive
	if err := json.Unmarshal(b, &p); err != nil {
		return err
	}
	switch p.T {
	case Init, Set, Call, Ret:
	default:
		return errors.New("trace: unknown event type " + string(p.T))
	}

	fill, err := decodeValue(p.Fill)
	if err != nil {
		return err
	}
	from, err := decodeValue(p.From)
	if err != nil {
		return err
	}
	to, err := decodeValue(p.To)
	if err != nil {
		return err
	}
	v, err := decodeValue(p.V)
	if err != nil {
		return err
	}

	args := make([]Arg, 0, len(p.Args))
	for _, a := range p.Args {
		av, err := decodeValue(a.V)
		if err != nil {
			return err
		}
		args = append(args, Arg{N: a.N, V: av})
	}
	deps := make([]Dep, 0, len(p.Deps))
	for _, d := range p.Deps {
		dv, err := decodeValue(d.V)
		if err != nil {
			return err
		}
		deps = append(deps, Dep{S: d.S, At: d.At, V: dv})
	}
	if len(args) == 0 {
		args = nil
	}
	if len(deps) == 0 {
		deps = nil
	}

	*e = Event{
		T: p.T, S: p.S, Kind: p.Kind, Dims: p.Dims, Fill: fill, Aux: p.Aux,
		Labels: p.Labels, Schema: p.Schema,
		At: p.At, From: from, To: to,
		Fn: p.Fn, Args: args, V: v,
		Expr: p.Expr, Deps: deps,
		Ln: p.Ln, G: p.G, Lvl: p.Lvl, Note: p.Note,
	}
	return nil
}
