package main

import (
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/gen"
	"github.com/sanu1001/orrery/internal/trace"
)

// maxPoints caps how many sizes each algorithm is run at.
//
// Twelve is enough for a curve to have a shape and cheap enough that
// `make traces` stays under a couple of seconds even with fib-naive in the set.
// More points would not change which model wins; they would only make the JSON
// the frontend downloads larger.
const maxPoints = 12

// Point is one measurement: the algorithm run at size n, and what it cost.
type Point struct {
	N         int  `json:"n"`
	Events    int  `json:"events"`
	Steps     int  `json:"steps"`
	Calls     int  `json:"calls"`
	Truncated bool `json:"truncated,omitempty"`
}

// Curve is everything the frontend needs to compare claimed against measured.
type Curve struct {
	Declared string   `json:"declared"`
	Sweep    []string `json:"sweep"`
	Points   []Point  `json:"points"`
}

// cmdComplexity measures how each algorithm actually grows.
//
// The counts are already in the trace -- `meta.counts` plus a scan for `call`
// events -- so this command runs each algorithm at a range of input sizes and
// writes the table out. Fitting a curve to it is the consumer's job, which
// keeps the arithmetic next to the chart that draws it.
//
// It is a build-time artifact for the same reason traces are: the browser
// cannot run Go, so measuring in the browser is not on the table, and shipping
// the measurements as static JSON keeps the feature working with the network
// off. ADR 0013.
func cmdComplexity(args []string) error {
	out := ""
	for i := 0; i < len(args); i++ {
		switch {
		case args[i] == "-o" && i+1 < len(args):
			out = args[i+1]
			i++
		case len(args[i]) > 3 && args[i][:3] == "-o=":
			out = args[i][3:]
		}
	}

	curves := map[string]Curve{}
	for _, spec := range algos.All() {
		lo, hi, ok := algos.SweepRange(spec)
		if !ok {
			// No declared sweep, or a range too narrow to have a shape. Skipped
			// rather than guessed: a curve fitted to two points fits anything.
			continue
		}
		stride := 1
		if n := hi - lo + 1; n > maxPoints {
			stride = (n + maxPoints - 1) / maxPoints
		}

		var pts []Point
		for n := lo; n <= hi; n += stride {
			in, ok := algos.SweepArgs(spec, n)
			if !ok {
				break
			}
			t, err := gen.Generate(spec.ID, in, 0, 5*time.Second)
			if err != nil {
				return fmt.Errorf("%s at n=%d: %w", spec.ID, n, err)
			}
			calls := 0
			for i := range t.Events {
				if t.Events[i].T == trace.Call {
					calls++
				}
			}
			pts = append(pts, Point{
				N: n, Events: t.Meta.Counts.Events, Steps: t.Meta.Counts.Steps,
				Calls: calls, Truncated: t.Meta.Truncated,
			})
		}
		if len(pts) < 3 {
			continue
		}
		curves[spec.ID] = Curve{Declared: spec.Complexity, Sweep: spec.Sweep, Points: pts}
	}

	b, err := json.MarshalIndent(curves, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')
	if out == "" {
		_, err = os.Stdout.Write(b)
		return err
	}
	if err := os.WriteFile(out, b, 0o644); err != nil {
		return err
	}
	fmt.Printf("measured %d algorithms -> %s\n", len(curves), out)
	return nil
}
