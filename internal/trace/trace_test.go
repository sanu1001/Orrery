package trace

import (
	"encoding/json"
	"os/exec"
	"strings"
	"testing"
)

func TestPathRoundTrip(t *testing.T) {
	cases := []struct {
		p    Path
		wire string
		key  string
	}{
		{Path{}, `[]`, "dp "},
		{P(3, 4), `[3,4]`, "dp 3/4"},
		{P("n7", "next"), `["n7","next"]`, "dp n7/next"},
		{P(NSRefs, "slow"), `["$refs","slow"]`, "dp $refs/slow"},
		{P(NSEdges, "a|b", "w"), `["$edges","a|b","w"]`, "dp $edges/a|b/w"},
	}
	for _, c := range cases {
		b, err := json.Marshal(c.p)
		if err != nil {
			t.Fatal(err)
		}
		if string(b) != c.wire {
			t.Errorf("marshal %v = %s, want %s", c.p, b, c.wire)
		}
		var back Path
		if err := json.Unmarshal(b, &back); err != nil {
			t.Fatal(err)
		}
		if !back.Equal(c.p) {
			t.Errorf("round trip changed %v into %v", c.p, back)
		}
		if got := c.p.KeyWith("dp"); got != c.key {
			t.Errorf("KeyWith(%v) = %q, want %q", c.p, got, c.key)
		}
	}
}

// A grid event must serialize EXACTLY as it did before `at` was widened from an
// integer index to a path. That backward compatibility is the whole reason the
// widening was chosen over a parallel node/edge event family. ADR 0004.
func TestGridWireFormatUnchanged(t *testing.T) {
	e := Event{T: Set, S: "dp", At: P(3, 4), From: 0.0, To: 7.0, Expr: "1 + dp[2][3]"}
	b, err := json.Marshal(e)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"t":"set","s":"dp","at":[3,4],"from":0,"to":7,"expr":"1 + dp[2][3]"}`
	if string(b) != want {
		t.Errorf("got  %s\nwant %s", b, want)
	}
}

// `omitempty` on a plain `any` would silently drop a legitimate "from": 0, and
// V4 would then compare nil against 0 and fail on every DP table. This test is
// the reason event.go carries custom marshalling.
func TestZeroValuesSurviveTheWire(t *testing.T) {
	for _, v := range []Value{0.0, false, "", nil} {
		e := Event{T: Set, S: "s", At: P(0), From: v, To: v}
		b, err := json.Marshal(e)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(b), `"from"`) || !strings.Contains(string(b), `"to"`) {
			t.Fatalf("from/to dropped for %v: %s", v, b)
		}
		var back Event
		if err := json.Unmarshal(b, &back); err != nil {
			t.Fatal(err)
		}
		if !Equal(back.From, v) || !Equal(back.To, v) {
			t.Errorf("value %v became from=%v to=%v", v, back.From, back.To)
		}
	}
}

func TestEqualNormalisesNumbers(t *testing.T) {
	if !Equal(7, 7.0) {
		t.Error("7 should equal 7.0 after JSON normalisation")
	}
	if Equal(7, "7") {
		t.Error("7 should not equal \"7\"")
	}
	if !Equal(Ref{ID: "n3"}, map[string]any{"$": "n3"}) {
		t.Error("a decoded ref should equal a constructed one")
	}
	if Equal(nil, 0) {
		t.Error("nil is not 0 -- the distinction is what makes 'absent' meaningful in a map")
	}
}

// Canon must agree with JavaScript's String(n) for every number the format can
// produce, or the two players hash the same state differently and the
// conformance suite fails in a confusing way. The known divergence risks are
// negative zero and exponent formatting.
func TestCanonMatchesJS(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not available")
	}
	nums := []float64{0, -0, 1, -1, 0.5, 1e20, 1e21, 1e-7, 123456789, 3.14159265358979,
		9007199254740991, 1.5e300, -2.5e-10}
	var js strings.Builder
	js.WriteString("const xs=[")
	for i, n := range nums {
		if i > 0 {
			js.WriteByte(',')
		}
		js.WriteString(Canon(n))
	}
	js.WriteString("];console.log(xs.map(x=>x===0?'0':String(x)).join('\\n'))")

	out, err := exec.Command("node", "-e", js.String()).Output()
	if err != nil {
		t.Skipf("node failed: %v", err)
	}
	got := strings.Split(strings.TrimSpace(string(out)), "\n")
	for i, n := range nums {
		if i >= len(got) {
			t.Fatalf("node returned %d lines for %d numbers", len(got), len(nums))
		}
		if Canon(n) != got[i] {
			t.Errorf("Canon(%v) = %q, JS String() = %q", n, Canon(n), got[i])
		}
	}
}

func TestBuildStepsGroups(t *testing.T) {
	evs := []Event{
		{T: Set, G: 0},
		{T: Set, G: 7},
		{T: Set, G: 7},
		{T: Set, G: 0},
		{T: Set, G: 0, Lvl: 1},
		{T: Set, G: 0},
	}
	steps := BuildSteps(evs, 0)
	if len(steps) != 4 {
		t.Fatalf("level 0: got %d steps, want 4 (the group counts once, the lvl-1 event is filtered)", len(steps))
	}
	if steps[1].E0 != 1 || steps[1].E1 != 3 {
		t.Errorf("group step covers [%d,%d), want [1,3)", steps[1].E0, steps[1].E1)
	}
	if got := len(BuildSteps(evs, 1)); got != 5 {
		t.Errorf("level 1: got %d steps, want 5", got)
	}
}

func TestStateHashSkipsFillValues(t *testing.T) {
	tt := &Trace{V: Version}
	s := NewState(tt)
	e := Event{T: Init, S: "g", Kind: KindGrid, Dims: []int{2, 2}, Fill: 0.0}
	if err := s.ApplyForward(0, &e, nil); err != nil {
		t.Fatal(err)
	}
	empty := s.Hash()

	// Writing the fill value must not change the hash. That equivalence is what
	// lets one implementation store grids sparsely and another densely while
	// still agreeing at every step.
	w := Event{T: Set, S: "g", At: P(0, 0), From: 0.0, To: 0.0}
	if err := s.ApplyForward(1, &w, nil); err != nil {
		t.Fatal(err)
	}
	if s.Hash() != empty {
		t.Error("writing the fill value changed the state hash")
	}

	w2 := Event{T: Set, S: "g", At: P(0, 0), From: 0.0, To: 5.0}
	if err := s.ApplyForward(2, &w2, nil); err != nil {
		t.Fatal(err)
	}
	if s.Hash() == empty {
		t.Error("writing a real value did not change the state hash")
	}
}

// Node creation must not alias the event's payload. Without the clone in
// Struct.Set, unapplying a node creation would mutate the very event that
// created it, and the second rewind through it would be wrong.
func TestNodeWritesDoNotAliasTheEvent(t *testing.T) {
	tt := &Trace{V: Version}
	s := NewState(tt)
	sch := Schema{Fields: map[string]FieldKind{"val": FScalar, "next": FPtr}}
	init := Event{T: Init, S: "L", Kind: KindNodes, Schema: &sch}
	if err := s.ApplyForward(0, &init, nil); err != nil {
		t.Fatal(err)
	}
	payload := Record{"val": 9.0, "next": nil}
	create := Event{T: Set, S: "L", At: P("n0"), From: nil, To: payload}
	if err := s.ApplyForward(1, &create, nil); err != nil {
		t.Fatal(err)
	}
	link := Event{T: Set, S: "L", At: P("n0", "next"), From: nil, To: Ref{ID: "n1"}}
	if err := s.ApplyForward(2, &link, nil); err != nil {
		t.Fatal(err)
	}
	if payload["next"] != nil {
		t.Fatal("writing a node field mutated the creating event's payload")
	}
}

func TestValidateNeverPanics(t *testing.T) {
	bad := []*Trace{
		nil,
		{V: 99},
		{V: 1, Events: []Event{{T: Set, S: "missing", At: P(0), To: 1.0}}},
		{V: 1, Events: []Event{{T: Ret, V: 1.0}}},
		{V: 1, Events: []Event{
			{T: Init, S: "a", Kind: KindArray, Dims: []int{2}, Fill: 0.0},
			{T: Set, S: "a", At: P(99), From: 0.0, To: 1.0},
		}},
		{V: 1, Events: []Event{
			{T: Init, S: "a", Kind: KindArray, Dims: []int{2}, Fill: 0.0},
			{T: Set, S: "a", At: P(0), From: 5.0, To: 1.0}, // wrong `from`
		}},
	}
	for i, tr := range bad {
		ds := Validate(tr)
		if !HasErrors(ds) {
			t.Errorf("case %d: expected at least one error", i)
		}
		for _, d := range ds {
			if d.Check == "V0" {
				t.Errorf("case %d: validator panicked: %s", i, d.Message)
			}
		}
	}
}

func FuzzDecodeValidate(f *testing.F) {
	f.Add([]byte(`{"v":1,"meta":{},"events":[]}`))
	f.Add([]byte(`{"v":1,"meta":{},"events":[{"t":"init","s":"a","kind":"array","dims":[2],"fill":0},{"t":"set","s":"a","at":[0],"from":0,"to":1}]}`))
	f.Add([]byte(`{"v":1,"meta":{},"events":[{"t":"call","fn":"f"},{"t":"ret","v":null}]}`))
	f.Fuzz(func(t *testing.T, b []byte) {
		tr, err := Decode(b)
		if err != nil || tr == nil {
			return
		}
		_ = Validate(tr) // must never panic
		s := NewState(tr)
		for i := range tr.Events {
			_ = s.ApplyForward(i, &tr.Events[i], nil)
		}
		for i := len(tr.Events) - 1; i >= 0; i-- {
			_ = s.ApplyBackward(i, &tr.Events[i], nil)
		}
	})
}
