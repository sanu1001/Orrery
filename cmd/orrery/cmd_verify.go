package main

import (
	"fmt"
	"os"

	"github.com/sanu1001/orrery/internal/replay"
	"github.com/sanu1001/orrery/internal/trace"
)

func load(path string) (*trace.Trace, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return trace.Decode(b)
}

func cmdVerify(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: orrery verify FILE...")
	}
	bad := 0
	for _, path := range args {
		t, err := load(path)
		if err != nil {
			fmt.Printf("%s: FAILED to load: %v\n", path, err)
			bad++
			continue
		}
		ds := trace.Validate(t)
		errs, warns := 0, 0
		for _, d := range ds {
			if d.Severity == trace.SevError {
				errs++
			} else {
				warns++
			}
		}
		status := "ok"
		if errs > 0 {
			status = "FAILED"
			bad++
		}
		fmt.Printf("%s: %s  (%d events, %d steps, %d errors, %d warnings)\n",
			path, status, t.Meta.Counts.Events, t.Meta.Counts.Steps, errs, warns)
		for _, d := range ds {
			fmt.Println("   ", d)
		}
	}
	if bad > 0 {
		return fmt.Errorf("%d file(s) failed validation", bad)
	}
	return nil
}

// cmdHash prints the state hash. With --all-steps it prints one line per step,
// which is exactly what scripts/conformance.sh diffs against the JavaScript
// player. If the two ever disagree at step 42, that line is where it shows.
func cmdHash(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: orrery hash FILE [--all-steps]")
	}
	allSteps := false
	var files []string
	for _, a := range args {
		if a == "--all-steps" {
			allSteps = true
		} else {
			files = append(files, a)
		}
	}
	for _, path := range files {
		t, err := load(path)
		if err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
		p, err := replay.New(t, 0)
		if err != nil {
			return err
		}
		name := t.Meta.Algo
		if !allSteps {
			for p.Next() {
			}
			fmt.Printf("%s %016x\n", name, p.Hash())
			continue
		}
		fmt.Printf("%s 0 %016x\n", name, p.Hash())
		for i := 1; p.Next(); i++ {
			fmt.Printf("%s %d %016x\n", name, i, p.Hash())
		}
	}
	return nil
}
