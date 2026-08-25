// Package replay is the Go-side player.
//
// It exists for two reasons, neither of which is serving production traffic:
//
//  1. to test the tracer, and
//  2. to prove the JavaScript player correct.
//
// (2) is the important one. Two independent implementations that must agree at
// every step is the MECHANISM by which the format gets tested -- not an
// accident of having two languages. scripts/conformance.sh diffs their state
// hashes. See ENGINE.md 7.3.
package replay

import (
	"fmt"

	"github.com/sanu1001/orrery/internal/trace"
)

// Player navigates a trace. Step semantics come from trace.BuildSteps, so the
// Go and JS players cannot disagree about what a step is.
type Player struct {
	tr    *trace.Trace
	steps []trace.Step
	state *trace.State
	level int

	// step is the index of the NEXT step to apply. 0 means "nothing applied".
	// A trace with n steps therefore has n+1 positions, 0..n.
	step    int
	changed map[string]bool
}

// New returns a player positioned before the first step.
func New(t *trace.Trace, level int) (*Player, error) {
	if t == nil {
		return nil, fmt.Errorf("replay: nil trace")
	}
	return &Player{
		tr:      t,
		steps:   trace.BuildSteps(t.Events, level),
		state:   trace.NewState(t),
		level:   level,
		changed: map[string]bool{},
	}, nil
}

func (p *Player) Steps() int          { return len(p.steps) }
func (p *Player) Step() int           { return p.step }
func (p *Player) State() *trace.State { return p.state }
func (p *Player) Trace() *trace.Trace { return p.tr }
func (p *Player) Hash() uint64        { return p.state.Hash() }

// EventIndex is the index of the next event that would be applied.
func (p *Player) EventIndex() int {
	if p.step >= len(p.steps) {
		return len(p.tr.Events)
	}
	return p.steps[p.step].E0
}

// CurrentEvents returns the events of the step just applied -- the explain
// pane's input. Empty before the first step.
func (p *Player) CurrentEvents() []trace.Event {
	if p.step == 0 {
		return nil
	}
	s := p.steps[p.step-1]
	return p.tr.Events[s.E0:s.E1]
}

// Changed returns the address keys touched by the last transition.
func (p *Player) Changed() []string {
	out := make([]string, 0, len(p.changed))
	for k := range p.changed {
		out = append(out, k)
	}
	return out
}

// Next applies the next step. Reports false at the end.
func (p *Player) Next() bool {
	if p.step >= len(p.steps) {
		return false
	}
	clear(p.changed)
	s := p.steps[p.step]
	for i := s.E0; i < s.E1; i++ {
		if err := p.state.ApplyForward(i, &p.tr.Events[i], p.changed); err != nil {
			panic(fmt.Sprintf("replay: forward at event %d: %v", i, err))
		}
	}
	p.step++
	return true
}

// Prev unapplies the previous step. Reports false at the start.
//
// Events within a step are unapplied in REVERSE order. Without that, a grouped
// swap rewinds into a duplicated value: unapplying a[i] then a[j] in forward
// order restores a[i]'s old value after a[j] has already been restored from it.
// This is the one place ordering matters. ADR 0020.
func (p *Player) Prev() bool {
	if p.step == 0 {
		return false
	}
	clear(p.changed)
	s := p.steps[p.step-1]
	for i := s.E1 - 1; i >= s.E0; i-- {
		if err := p.state.ApplyBackward(i, &p.tr.Events[i], p.changed); err != nil {
			panic(fmt.Sprintf("replay: backward at event %d: %v", i, err))
		}
	}
	p.step--
	return true
}

// Seek moves to a step INCREMENTALLY from the current position -- never by
// replaying from 0.
//
// That is the entire point of a reversible log: seeking is O(distance), not
// O(target). It also keeps Prev on the hot path, which is the direction that
// actually breaks. A seek implemented as "reset and replay forward" would be
// correct and would hide every backward bug.
func (p *Player) Seek(step int) error {
	if step < 0 || step > len(p.steps) {
		return fmt.Errorf("replay: step %d out of range [0,%d]", step, len(p.steps))
	}
	acc := map[string]bool{}
	for p.step < step {
		p.Next()
		for k := range p.changed {
			acc[k] = true
		}
	}
	for p.step > step {
		p.Prev()
		for k := range p.changed {
			acc[k] = true
		}
	}
	p.changed = acc
	return nil
}

// Stack returns the currently open call frames, oldest first.
func (p *Player) Stack() []trace.Event {
	out := make([]trace.Event, 0, len(p.state.Stack))
	for _, i := range p.state.Stack {
		out = append(out, p.tr.Events[i])
	}
	return out
}

// StackIndices returns the event indices of the open frames.
func (p *Player) StackIndices() []int { return p.state.Stack }
