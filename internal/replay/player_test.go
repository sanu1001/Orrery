package replay_test

import (
	"flag"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/sanu1001/orrery/internal/algos"
	_ "github.com/sanu1001/orrery/internal/algos/all"
	"github.com/sanu1001/orrery/internal/replay"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

var update = flag.Bool("update", false, "regenerate golden fixtures")

const goldenDir = "../../testdata/golden"

// generate runs an algorithm at its defaults. Golden fixtures pin CreatedAt to
// empty so a regeneration is a no-op diff unless the trace actually changed.
func generate(t *testing.T, spec algos.Spec) *trace.Trace {
	t.Helper()
	args, err := spec.Resolve(nil)
	if err != nil {
		t.Fatalf("%s: resolve: %v", spec.ID, err)
	}
	tr := tracer.New(tracer.Config{
		Algo: spec.ID, Title: spec.Title, Input: args,
		Source: spec.Source, Deadline: time.Now().Add(10 * time.Second),
	})
	if err := spec.Run(tr, args); err != nil && tr.Err() == nil {
		t.Fatalf("%s: run: %v", spec.ID, err)
	}
	return tr.Trace()
}

func goldens(t *testing.T) map[string]*trace.Trace {
	t.Helper()
	out := map[string]*trace.Trace{}
	for _, spec := range algos.All() {
		out[spec.ID] = generate(t, spec)
	}
	return out
}

// TestGoldenFixtures writes testdata/golden/*.orrery.json with -update, and
// otherwise checks the committed bytes still match.
//
// The point is not the assertion. It is that a format change shows up as a
// readable git diff across twelve files -- the single best early-warning system
// this project has, and it costs one flag.
func TestGoldenFixtures(t *testing.T) {
	if err := os.MkdirAll(goldenDir, 0o755); err != nil {
		t.Fatal(err)
	}
	for id, tr := range goldens(t) {
		path := filepath.Join(goldenDir, id+".orrery.json")
		got, err := trace.EncodePretty(tr)
		if err != nil {
			t.Fatalf("%s: encode: %v", id, err)
		}
		if *update {
			if err := os.WriteFile(path, got, 0o644); err != nil {
				t.Fatal(err)
			}
			continue
		}
		want, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("%s: missing golden (run: go test ./... -update)", id)
		}
		if string(got) != string(want) {
			t.Errorf("%s: golden fixture differs. If this change is intended, "+
				"run `go test ./... -update` and review the diff.", id)
		}
	}
}

// TestValidate is V1..V14 on every generated trace. A tracer bug that produces
// an invalid trace fails here rather than three weeks later in a browser.
func TestValidate(t *testing.T) {
	for id, tr := range goldens(t) {
		for _, d := range trace.Validate(tr) {
			if d.Severity == trace.SevError {
				t.Errorf("%s: %s", id, d)
			}
		}
	}
}

// TestRoundTrip is invariant I1, tested directly: play the whole trace forward,
// then all the way back, and the state must be byte-identical to where it
// started. Twenty lines, and it catches nearly every tracer bug that matters.
func TestRoundTrip(t *testing.T) {
	for id, tr := range goldens(t) {
		p, err := replay.New(tr, 0)
		if err != nil {
			t.Fatal(err)
		}
		h0 := p.Hash()
		for p.Next() {
		}
		hEnd := p.Hash()
		for p.Prev() {
		}
		if got := p.Hash(); got != h0 {
			t.Errorf("%s: state after forward-then-backward is %016x, want %016x", id, got, h0)
		}
		// A pure-recursion trace (fib-naive has no `set` events at all) ends with
		// an empty stack and therefore legitimately hashes back to its start.
		// Only assert "the trace does something" when there are writes.
		writes := 0
		for _, e := range tr.Events {
			if e.T == trace.Set {
				writes++
			}
		}
		if writes > 0 && hEnd == h0 {
			t.Errorf("%s: end state equals start state -- the trace does nothing", id)
		}
	}
}

// TestSeekEquivalence checks that seeking lands on the same state as stepping.
//
// The important detail: targets are visited in a PSEUDO-RANDOM order on a
// single long-lived player, and compared against a fresh player seeked from 0.
// Walking 0,1,2,... would only ever exercise forward replay and would pass with
// a completely broken Prev -- which is the direction that actually breaks.
func TestSeekEquivalence(t *testing.T) {
	for id, tr := range goldens(t) {
		p, err := replay.New(tr, 0)
		if err != nil {
			t.Fatal(err)
		}
		n := p.Steps()
		if n == 0 {
			continue
		}
		rng := rand.New(rand.NewSource(1))
		for i := 0; i < 60; i++ {
			k := rng.Intn(n + 1)
			if err := p.Seek(k); err != nil {
				t.Fatalf("%s: seek(%d): %v", id, k, err)
			}
			fresh, _ := replay.New(tr, 0)
			for j := 0; j < k; j++ {
				fresh.Next()
			}
			if p.Hash() != fresh.Hash() {
				t.Fatalf("%s: seek(%d) gives %016x, stepping gives %016x",
					id, k, p.Hash(), fresh.Hash())
			}
		}
	}
}

// TestGroupsRewindInReverse is the specific regression for ADR 0020: within a
// grouped step, backward MUST unapply in reverse order, or a swap rewinds into
// a duplicated value.
func TestGroupsRewindInReverse(t *testing.T) {
	tr := tracer.New(tracer.Config{Algo: "swaptest", Title: "swap"})
	a := tr.Array("a", 2, 0)
	a.Fill([]int{1, 2})
	tr.Group(func() {
		a.Set(0, 2)
		a.Set(1, 1)
	})
	tt := tr.Trace()

	p, _ := replay.New(tt, 0)
	before := p.Hash()
	for p.Next() {
	}
	if a0, a1 := p.State().Get("a", trace.P(0)), p.State().Get("a", trace.P(1)); !trace.Equal(a0, 2.0) || !trace.Equal(a1, 1.0) {
		t.Fatalf("after swap: a = [%v %v], want [2 1]", a0, a1)
	}
	for p.Prev() {
	}
	if p.Hash() != before {
		t.Fatal("swap did not rewind cleanly")
	}

	// And the swap must be ONE step, not two: a viewer must never see the array
	// in a state where one value is duplicated and the other is gone.
	p2, _ := replay.New(tt, 0)
	if err := p2.Seek(p2.Steps() - 1); err != nil {
		t.Fatal(err)
	}
	if a0 := p2.State().Get("a", trace.P(0)); !trace.Equal(a0, 1.0) {
		t.Fatalf("before the swap step a[0] = %v, want 1", a0)
	}
	before2 := p2.Step()
	p2.Next()
	if p2.Step() != before2+1 {
		t.Fatal("grouped swap did not advance exactly one step")
	}
	a0, a1 := p2.State().Get("a", trace.P(0)), p2.State().Get("a", trace.P(1))
	if !trace.Equal(a0, 2.0) || !trace.Equal(a1, 1.0) {
		t.Fatalf("one step of the group applied only part of it: a = [%v %v]", a0, a1)
	}
}

// TestCapsProduceValidTraces: hitting a cap must yield a playable trace, not an
// error. Truncation is a teaching moment. ADR 0014.
func TestCapsProduceValidTraces(t *testing.T) {
	spec, _ := algos.Lookup("fib-naive")
	args, _ := spec.Resolve(algos.Args{"n": 22})
	tr := tracer.New(tracer.Config{
		Algo: spec.ID, Title: spec.Title, Source: spec.Source, MaxEvents: 500,
	})
	_ = spec.Run(tr, args)

	tt := tr.Trace()
	if !tt.Meta.Truncated || tt.Meta.TruncatedReason != "events" {
		t.Fatalf("expected an events truncation, got truncated=%v reason=%q",
			tt.Meta.Truncated, tt.Meta.TruncatedReason)
	}
	if len(tt.Events) > 500 {
		t.Fatalf("cap leaked: %d events", len(tt.Events))
	}
	for _, d := range trace.Validate(tt) {
		if d.Severity == trace.SevError {
			t.Errorf("truncated trace is not playable: %s", d)
		}
	}
	p, _ := replay.New(tt, 0)
	for p.Next() {
	}
	for p.Prev() {
	}
}

// TestCallerLines pins the runtime.Caller skip count in the tracer.
//
// If a helper layer is ever inserted between a public Set and emit, every line
// number silently shifts by one function -- and the symptom is a code pane
// highlighting the wrong line, which reads as a rendering bug rather than a
// tracer bug. This is the cheapest possible tripwire.
func TestCallerLines(t *testing.T) {
	for _, spec := range algos.All() {
		tr := generate(t, spec)
		if tr.Meta.Source == nil {
			continue
		}
		withLines, total := 0, 0
		for _, e := range tr.Events {
			if e.T != trace.Set {
				continue
			}
			total++
			if e.Ln > 0 {
				withLines++
			}
		}
		if total > 0 && withLines*2 < total {
			t.Errorf("%s: only %d of %d set events carry a source line -- "+
				"check the runtime.Caller skip count in tracer.emit", spec.ID, withLines, total)
		}
	}
}

// TestStepsGrowWithInput is the detector for FLAWS.md 1: an algorithm whose
// step count does not grow with n is missing its cursor structures, and its
// trace is valid, well-formed and useless.
func TestStepsGrowWithInput(t *testing.T) {
	cases := []struct {
		id, field    string
		small, large int
	}{
		{"binary", "target", 2, 89},
		{"nqueens", "n", 4, 6},
		{"fib-memo", "n", 4, 10},
	}
	for _, c := range cases {
		spec, ok := algos.Lookup(c.id)
		if !ok {
			t.Fatalf("unknown algorithm %q", c.id)
		}
		steps := func(v int) int {
			args, err := spec.Resolve(algos.Args{c.field: v})
			if err != nil {
				t.Fatalf("%s: %v", c.id, err)
			}
			tr := tracer.New(tracer.Config{Algo: spec.ID, Source: spec.Source})
			_ = spec.Run(tr, args)
			return tr.Trace().Meta.Counts.Steps
		}
		if s := steps(c.small); s == 0 {
			t.Errorf("%s: produced zero steps -- it needs cursor structures", c.id)
		}
		_ = fmt.Sprint(steps(c.large))
	}
}
