package trace

import (
	"fmt"
	"strings"
)

// Severity of a validator diagnostic.
type Severity string

const (
	SevError   Severity = "error"
	SevWarning Severity = "warning"
)

// Diag is one validator finding.
type Diag struct {
	Check    string   `json:"check"`
	Severity Severity `json:"severity"`
	Event    int      `json:"event"` // event index, -1 for trace-level
	Message  string   `json:"message"`
}

func (d Diag) String() string {
	where := "trace"
	if d.Event >= 0 {
		where = fmt.Sprintf("event %d", d.Event)
	}
	return fmt.Sprintf("%s [%s] %s: %s", d.Check, d.Severity, where, d.Message)
}

// HasErrors reports whether any diagnostic is an error.
func HasErrors(ds []Diag) bool {
	for _, d := range ds {
		if d.Severity == SevError {
			return true
		}
	}
	return false
}

// Validate implements checks V1..V14 from TRACE_FORMAT.md 10.
//
// It MUST NOT panic on any input -- the JS twin of this function is the
// browser's trust boundary against arbitrary shared traces, and fuzz_test.go
// asserts the no-panic property here.
//
// V4 and V6 are the two that matter. Together they constitute a complete proof
// that the trace is a valid reversible delta log:
//
//	V4  replaying forward, every set.From deep-equals current state at set.At
//	V6  full forward replay then full backward replay returns the initial state
func Validate(t *Trace) (diags []Diag) {
	defer func() {
		if r := recover(); r != nil {
			diags = append(diags, Diag{"V0", SevError, -1,
				fmt.Sprintf("validator panicked: %v (this is a bug in Orrery)", r)})
		}
	}()

	add := func(check string, sev Severity, ev int, format string, a ...any) {
		diags = append(diags, Diag{check, sev, ev, fmt.Sprintf(format, a...)})
	}

	if t == nil {
		add("V1", SevError, -1, "trace is nil")
		return
	}

	// V1 -- version in range.
	if t.V < SupportedMin || t.V > SupportedMax {
		add("V1", SevError, -1, "version %d outside supported range [%d,%d]",
			t.V, SupportedMin, SupportedMax)
		return // nothing below is meaningful against an unknown version
	}

	// Declarations seen so far, and the aux flag per structure.
	decls := map[string]*Event{}
	aux := map[string]bool{}
	written := map[string]bool{}

	state := NewState(t)
	depth := 0
	prevG, seenG := 0, map[int]bool{}
	srcLines := 0
	if t.Meta.Source != nil {
		srcLines = strings.Count(t.Meta.Source.Text, "\n") + 1
	}

	// Snapshot of the initial hash for V6. The initial state is empty (no
	// structure exists before the first init), so this is the empty hash.
	initialHash := state.Hash()

	for i := range t.Events {
		e := &t.Events[i]

		// V7 -- group ids form contiguous runs.
		if e.G != 0 {
			if e.G != prevG && seenG[e.G] {
				add("V7", SevError, i, "group id %d reappears after a gap", e.G)
			}
			seenG[e.G] = true
		}
		prevG = e.G

		// V10 -- line within source bounds.
		if e.Ln != 0 && srcLines > 0 && e.Ln > srcLines {
			add("V10", SevWarning, i, "ln %d is past the end of meta.source.text (%d lines)", e.Ln, srcLines)
		}

		switch e.T {
		case Init:
			if e.S == "" {
				add("V2", SevError, i, "init has no structure name")
				continue
			}
			if _, dup := decls[e.S]; dup {
				add("V2", SevError, i, "structure %q initialised twice", e.S)
				continue
			}
			if e.Kind.IsNodeKind() && e.Schema == nil {
				add("V3", SevError, i, "structure %q is kind %q but declares no schema", e.S, e.Kind)
			}
			if e.Kind == KindGrid && len(e.Dims) != 2 {
				add("V3", SevError, i, "grid %q needs dims [rows,cols], got %v", e.S, e.Dims)
			}
			if e.Kind == KindArray && len(e.Dims) != 1 {
				add("V3", SevError, i, "array %q needs dims [n], got %v", e.S, e.Dims)
			}
			decls[e.S] = e
			aux[e.S] = e.Aux

		case Set:
			decl, ok := decls[e.S]
			if !ok {
				// V2
				add("V2", SevError, i, "set writes to %q, which was never initialised", e.S)
				continue
			}
			// V3 -- address well-formed for the kind.
			if msg := checkAddr(decl, e.At); msg != "" {
				add("V3", SevError, i, "%s", msg)
			}
			// V12 -- reserved node id prefix.
			if decl.Kind.IsNodeKind() && len(e.At) > 0 && !e.At[0].IsIdx {
				head := e.At[0].S
				if strings.HasPrefix(head, "$") && head != NSRefs && head != NSEdges {
					add("V12", SevError, i, "node id %q may not begin with '$'", head)
				}
			}
			// V8 -- detail levels only on aux structures.
			if e.Lvl > 0 && !aux[e.S] {
				add("V8", SevError, i, "lvl %d on %q, which is not declared aux "+
					"(filtering it would corrupt replay -- see ADR 0016)", e.Lvl, e.S)
			}
			// V4 -- from matches current state.
			if cur := state.Get(e.S, e.At); !Equal(cur, e.From) {
				add("V4", SevError, i, "from is %s but %s currently holds %s",
					Canon(e.From), e.At.KeyWith(e.S), Canon(cur))
			}
			// V11 -- redundant no-op write.
			//
			// Only on a REPEAT write. The first write to a cell that happens to
			// equal the fill value is not a bug -- it is a computed cell whose
			// answer is the fill, and it is exactly the case the grid renderer
			// distinguishes as "computed 0" versus "still 0". Flagging it would
			// warn on almost every DP table, which trains you to ignore V11.
			key := e.At.KeyWith(e.S)
			if Equal(e.From, e.To) && written[key] {
				add("V11", SevWarning, i, "%s is written again with the value it already has (%s)",
					key, Canon(e.To))
			}
			written[key] = true

		case Call:
			depth++

		case Ret:
			depth--
			if depth < 0 {
				add("V5", SevError, i, "ret with no open call")
				depth = 0
			}
		}

		// V9 -- deps refer to live structures.
		for _, d := range e.Deps {
			ds, ok := decls[d.S]
			if !ok {
				add("V9", SevError, i, "dep refers to %q, which does not exist yet", d.S)
				continue
			}
			// An aux structure is hidden at detail level 0. If a level-0 event's
			// explanation cites one, the user reads "where mid was 4" about
			// something not on screen.
			//
			// This is a WARNING, not an error, and the distinction is worth
			// stating because the first draft of this rule got it wrong and
			// rejected binary search -- an algorithm the design specifically
			// exists to support.
			//
			// Filtering is sound for a sharper reason than "aux structures are
			// never read": every `set` carries its full `to` value, never a
			// delta, so dropping event X cannot change the value any other event
			// writes. The ONLY casualty of filtering is X's own structure going
			// stale -- which is harmless precisely because `aux` is what makes
			// it hidden. Aux-reads-aux (mid = (lo+hi)/2) is therefore fine: the
			// whole cluster is filtered together.
			if aux[d.S] && e.Lvl == 0 && !aux[e.S] {
				add("V8", SevWarning, i, "explanation cites aux structure %q, "+
					"which is hidden at detail level 0", d.S)
			}
			if msg := checkAddr(ds, d.At); msg != "" {
				add("V9", SevError, i, "dep address: %s", msg)
			}
		}

		if err := state.ApplyForward(i, e, nil); err != nil {
			add("V2", SevError, i, "%v", err)
		}
	}

	// V5 -- unbalanced at the end. Legal only for a truncated trace.
	if depth > 0 && !t.Meta.Truncated {
		diags = append(diags, Diag{"V5", SevError, -1,
			fmt.Sprintf("%d call(s) never returned in a trace that is not marked truncated", depth)})
	}

	// V6 -- full backward replay returns to the initial state.
	for i := len(t.Events) - 1; i >= 0; i-- {
		if err := state.ApplyBackward(i, &t.Events[i], nil); err != nil {
			diags = append(diags, Diag{"V6", SevError, i, err.Error()})
			break
		}
	}
	if h := state.Hash(); h != initialHash {
		diags = append(diags, Diag{"V6", SevError, -1,
			"state after a full forward-then-backward replay differs from the initial state"})
	}

	// V13 -- view hints name real structures.
	for _, v := range t.Meta.Views {
		if v.S == "$calls" {
			continue
		}
		if _, ok := decls[v.S]; !ok {
			diags = append(diags, Diag{"V13", SevWarning, -1,
				fmt.Sprintf("view %q names structure %q, which the trace never creates", v.Family, v.S)})
		}
	}

	// V14 -- byte cap.
	if b, err := Encode(t); err == nil && len(b) > DefaultMaxBytes {
		diags = append(diags, Diag{"V14", SevWarning, -1,
			fmt.Sprintf("serialized trace is %d bytes, over the %d byte soft cap", len(b), DefaultMaxBytes)})
	}
	return diags
}

// DefaultMaxBytes is the soft serialized-size cap. Producers enforce it; the
// validator only warns, because a large trace that arrived is still playable.
const DefaultMaxBytes = 8 << 20

func checkAddr(decl *Event, at Path) string {
	switch decl.Kind {
	case KindScalar:
		if len(at) != 0 {
			return fmt.Sprintf("scalar %q is addressed by [], got %v", decl.S, at.Join())
		}
	case KindArray:
		if len(at) != 1 || !at[0].IsIdx {
			return fmt.Sprintf("array %q needs a single integer index, got %q", decl.S, at.Join())
		}
		if len(decl.Dims) == 1 && (at[0].I < 0 || at[0].I >= decl.Dims[0]) {
			return fmt.Sprintf("index %d is outside array %q of length %d", at[0].I, decl.S, decl.Dims[0])
		}
	case KindGrid:
		if len(at) != 2 || !at[0].IsIdx || !at[1].IsIdx {
			return fmt.Sprintf("grid %q needs two integer indices, got %q", decl.S, at.Join())
		}
		if len(decl.Dims) == 2 {
			if at[0].I < 0 || at[0].I >= decl.Dims[0] || at[1].I < 0 || at[1].I >= decl.Dims[1] {
				return fmt.Sprintf("(%d,%d) is outside grid %q of size %dx%d",
					at[0].I, at[1].I, decl.S, decl.Dims[0], decl.Dims[1])
			}
		}
	case KindMap:
		if len(at) == 0 {
			return fmt.Sprintf("map %q needs at least one key segment", decl.S)
		}
	case KindNodes, KindGraph:
		if len(at) == 0 {
			return fmt.Sprintf("%q needs at least a node id", decl.S)
		}
		if at[0].IsIdx {
			return fmt.Sprintf("%q is addressed by node id, got integer %d", decl.S, at[0].I)
		}
	}
	return ""
}
