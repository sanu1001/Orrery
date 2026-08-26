// Package gen turns the algorithm registry into the two artifacts every
// consumer needs: a trace, and the catalogue.
//
// It exists as a package only because three binaries need both:
// the CLI, orreryd, and the golden-fixture generator. It began inside
// cmd/orrery, whose comment already claimed it was "shared by the server" --
// a claim package main cannot honour, because nothing can import it.
//
// The alternative was a copy in each binary. That loses the moment the two
// drift: the instant the CLI and the server produce different bytes for the
// same input, every golden fixture stops meaning anything, and the conformance
// suite is comparing two things that were never required to agree.
package gen

import (
	"fmt"
	"time"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

// Generate runs one algorithm and returns its trace.
//
// deadline of 0 means no wall clock cap. A run that hits the cap is NOT an
// error: the tracer marks the trace truncated and returns what it has, because
// a partial trace of an exponential algorithm is the teaching moment, not a
// failure. ADR 0014.
func Generate(id string, in algos.Args, seed int64, deadline time.Duration) (*trace.Trace, error) {
	spec, ok := algos.Lookup(id)
	if !ok {
		return nil, fmt.Errorf("unknown algorithm %q (try `orrery ls`)", id)
	}
	resolved, err := spec.Resolve(in)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", id, err)
	}
	cfg := tracer.Config{
		Algo: spec.ID, Title: spec.Title, Input: resolved, Seed: seed,
		Source: spec.Source,
	}
	if deadline > 0 {
		cfg.Deadline = time.Now().Add(deadline)
	}
	tr := tracer.New(cfg)
	if err := spec.Run(tr, resolved); err != nil && tr.Err() == nil {
		return nil, err
	}
	return tr.Trace(), nil
}
