package main

import (
	"fmt"
	"strings"

	"github.com/sanu1001/orrery/internal/trace"
)

// explain is the Go twin of web/src/lib/explain.js.
//
// This is the ENTIRE "plain English" system: one generic template, no
// per-algorithm code (invariant I2), no language model. Everything it needs is
// already in the event -- `expr` says how the value was computed, `deps` says
// what was read and what those cells held AT READ TIME.
//
// Snapshotting the dep values into the event rather than looking them up during
// replay is what makes the explanation exact while stepping BACKWARD: current
// state during a rewind is not the state the read saw. ADR 0005.
func explain(e trace.Event, t *trace.Trace) string {
	switch e.T {
	case trace.Init:
		return ""
	case trace.Call:
		return callLabel(e)
	case trace.Ret:
		var b strings.Builder
		fmt.Fprintf(&b, "returns %s", trace.Canon(e.V))
		if e.Note != "" {
			fmt.Fprintf(&b, " -- %s", e.Note)
		} else if e.Expr != "" {
			fmt.Fprintf(&b, " -- %s", e.Expr)
		}
		if w := where(e.Deps); w != "" {
			fmt.Fprintf(&b, ", %s", w)
		}
		return b.String()
	case trace.Set:
		addr := addrLabel(e.S, e.At)
		var b strings.Builder
		if e.From == nil && e.To != nil {
			fmt.Fprintf(&b, "%s <- %s", addr, trace.Canon(e.To))
		} else {
			fmt.Fprintf(&b, "%s: %s -> %s", addr, trace.Canon(e.From), trace.Canon(e.To))
		}
		switch {
		case e.Note != "":
			fmt.Fprintf(&b, " -- %s", e.Note)
		case e.Expr != "":
			fmt.Fprintf(&b, " -- %s", e.Expr)
		}
		if w := where(e.Deps); w != "" {
			fmt.Fprintf(&b, ", %s", w)
		}
		return b.String()
	}
	return ""
}

// addrLabel renders "dp[3][4]" for numeric paths and "L.n3.next" for named
// ones, because those are how a reader of the ALGORITHM would write them.
func addrLabel(name string, at trace.Path) string {
	if len(at) == 0 {
		return name
	}
	numeric := true
	for _, s := range at {
		if !s.IsIdx {
			numeric = false
			break
		}
	}
	var b strings.Builder
	b.WriteString(name)
	if numeric {
		for _, s := range at {
			fmt.Fprintf(&b, "[%d]", s.I)
		}
		return b.String()
	}
	for _, s := range at {
		if s.IsIdx {
			fmt.Fprintf(&b, "[%d]", s.I)
		} else {
			fmt.Fprintf(&b, ".%s", s.S)
		}
	}
	return b.String()
}

func where(deps []trace.Dep) string {
	if len(deps) == 0 {
		return ""
	}
	parts := make([]string, 0, len(deps))
	for _, d := range deps {
		parts = append(parts, fmt.Sprintf("%s was %s", addrLabel(d.S, d.At), trace.Canon(d.V)))
	}
	return "where " + strings.Join(parts, ", ")
}
