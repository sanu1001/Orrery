// Package trace defines the Orrery trace format: a flat, ordered list of
// reversible events that fully describes an algorithm's execution.
//
// This package MUST NOT import anything outside the Go standard library.
// deps_test.go enforces that. It is the artifact another project would vendor.
//
// Spec: workshop/TRACE_FORMAT.md. If this code and the spec disagree, the spec
// is right and this code is a bug.
package trace

import (
	"encoding/json"
	"time"
)

// Format version. See ADR 0019.
//
// Additive changes (a new optional field, a new Kind, a new view family) do NOT
// bump Version. Consumers must ignore unknown keys and degrade gracefully on
// unknown enum values.
//
// Breaking changes (removing or retyping a field, changing path semantics,
// adding a fifth event type) DO bump it.
const (
	Version      = 1
	SupportedMin = 1
	SupportedMax = 1
)

// Engine identifies the producer. It is part of the trace cache key, so
// bumping it invalidates every cached trace.
const Engine = "orrery/0.1.0"

// Trace is the whole artifact. Exactly three top-level keys.
type Trace struct {
	V      int     `json:"v"`
	Meta   Meta    `json:"meta"`
	Events []Event `json:"events"`
}

type Meta struct {
	Algo  string          `json:"algo"` // registry id, stable, [a-z0-9_-]+
	Title string          `json:"title"`
	Lang  string          `json:"lang"` // go | cpp | fixture
	Input json.RawMessage `json:"input,omitempty"`

	// Seed is the PRNG seed for any randomly generated input, and for
	// force-directed graph layout. 0 means "not random". Recording it is what
	// makes share links reproducible. See ADR 0007.
	Seed int64 `json:"seed,omitempty"`

	// Source is the code the CODE PANE displays. Always the ORIGINAL source,
	// never an instrumented rewrite. Every Event.Ln indexes into Source.Text.
	Source *Source `json:"source,omitempty"`

	// Views are declarative render hints. Data, not code -- see ADR 0012.
	// Absent is legal; consumers fall back to a kind->family table.
	Views []View `json:"views,omitempty"`

	Counts Counts `json:"counts"`

	// Truncated is set when a cap fired. The trace is still valid and playable
	// up to that point. This is a teaching moment, not an error. ADR 0014.
	Truncated       bool   `json:"truncated,omitempty"`
	TruncatedReason string `json:"truncatedReason,omitempty"` // events | bytes | wall

	Engine    string `json:"engine"`
	CreatedAt string `json:"createdAt,omitempty"` // RFC3339; string so goldens are stable
}

type Source struct {
	Path      string `json:"path"`
	Text      string `json:"text"`
	FirstLine int    `json:"firstLine"`
}

// View names a renderer family for a structure and places it in a pane.
type View struct {
	Family  string         `json:"family"` // linear|grid|callStack|recursionTree|tree|linkedList|graph|fallback
	S       string         `json:"s"`      // structure name, or "$calls"
	Pane    any            `json:"pane"`   // 0 | 1 | "side"
	Title   string         `json:"title,omitempty"`
	Options map[string]any `json:"options,omitempty"` // family-specific, opaque elsewhere
}

type Counts struct {
	Events  int `json:"events"`
	Steps   int `json:"steps"`
	Structs int `json:"structs"`
}

// Now is indirected so tests and golden generation can pin it.
var Now = func() time.Time { return time.Now().UTC() }
