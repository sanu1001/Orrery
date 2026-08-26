package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/gen"
	"github.com/sanu1001/orrery/internal/trace"
)

func cmdLs(args []string) error {
	idsOnly := false
	for _, a := range args {
		if a == "--ids" {
			idsOnly = true
		}
	}
	family := ""
	for _, s := range algos.All() {
		if idsOnly {
			fmt.Println(s.ID)
			continue
		}
		if s.Family != family {
			family = s.Family
			fmt.Printf("\n%s\n", strings.ToUpper(family))
		}
		fmt.Printf("  %-14s %-32s %s\n", s.ID, s.Title, s.Blurb)
	}
	if !idsOnly {
		fmt.Println()
	}
	return nil
}

// parseFlags turns --key=value pairs into Args, using the algorithm's own
// InputSpec to decide how to read each one. The CLI therefore needs no
// per-algorithm code, exactly as the web input form needs none.
func parseFlags(spec algos.Spec, args []string) (algos.Args, string, error) {
	out := algos.Args{}
	outFile := ""
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "-o" && i+1 < len(args):
			outFile = args[i+1]
			i++
			continue
		case strings.HasPrefix(a, "-o="):
			outFile = a[3:]
			continue
		case !strings.HasPrefix(a, "--"):
			return nil, "", fmt.Errorf("unexpected argument %q", a)
		}
		kv := strings.SplitN(strings.TrimPrefix(a, "--"), "=", 2)
		if len(kv) != 2 {
			return nil, "", fmt.Errorf("flag %q needs a value, e.g. --%s=...", a, kv[0])
		}
		name, raw := kv[0], kv[1]

		var f *algos.InputSpec
		for i := range spec.Inputs {
			if spec.Inputs[i].Name == name {
				f = &spec.Inputs[i]
				break
			}
		}
		if f == nil {
			return nil, "", fmt.Errorf("%s has no input called %q", spec.ID, name)
		}
		switch f.Kind {
		case "int":
			n, err := strconv.Atoi(raw)
			if err != nil {
				return nil, "", fmt.Errorf("--%s: %q is not a number", name, raw)
			}
			out[name] = n
		case "intList":
			parts := strings.Split(raw, ",")
			list := make([]int, 0, len(parts))
			for _, p := range parts {
				p = strings.TrimSpace(p)
				if p == "" {
					continue
				}
				n, err := strconv.Atoi(p)
				if err != nil {
					return nil, "", fmt.Errorf("--%s: %q is not a number", name, p)
				}
				list = append(list, n)
			}
			out[name] = list
		case "tree":
			// Brackets are tolerated because the realistic input is a paste
			// straight from a problem statement: --tree=[1,2,null,3,4].
			parts := strings.Split(strings.Trim(strings.TrimSpace(raw), "[]"), ",")
			toks := make([]any, 0, len(parts))
			for _, p := range parts {
				p = strings.TrimSpace(p)
				if p == "" {
					continue
				}
				// A null is a real token here, not a gap. Dropping it changes
				// which node the next value hangs off.
				if p == "null" || p == "nil" || p == "-" {
					toks = append(toks, nil)
					continue
				}
				n, err := strconv.Atoi(p)
				if err != nil {
					return nil, "", fmt.Errorf("--%s: %q is neither a number nor null", name, p)
				}
				toks = append(toks, n)
			}
			out[name] = toks
		default:
			out[name] = raw
		}
	}
	return out, outFile, nil
}

func cmdTrace(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: orrery trace <algo> [--key=value] [-o file]")
	}
	id := args[0]
	spec, ok := algos.Lookup(id)
	if !ok {
		return fmt.Errorf("unknown algorithm %q (try `orrery ls`)", id)
	}
	in, outFile, err := parseFlags(spec, args[1:])
	if err != nil {
		return err
	}

	t, err := gen.Generate(id, in, 0, 5*time.Second)
	if err != nil {
		return err
	}
	if ds := trace.Validate(t); trace.HasErrors(ds) {
		for _, d := range ds {
			if d.Severity == trace.SevError {
				fmt.Fprintln(os.Stderr, "  ", d)
			}
		}
		return fmt.Errorf("generated trace is invalid -- this is a bug in Orrery, not in your input")
	}

	var b []byte
	if outFile != "" {
		b, err = trace.EncodePretty(t)
	} else {
		b, err = trace.Encode(t)
	}
	if err != nil {
		return err
	}
	if outFile == "" {
		_, err = os.Stdout.Write(append(b, '\n'))
		return err
	}
	if err := os.WriteFile(outFile, b, 0o644); err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "%s: %d events, %d steps, %d bytes -> %s\n",
		id, t.Meta.Counts.Events, t.Meta.Counts.Steps, len(b), outFile)
	if t.Meta.Truncated {
		fmt.Fprintf(os.Stderr, "  note: truncated (%s)\n", t.Meta.TruncatedReason)
	}
	return nil
}

func cmdBench(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: orrery bench <algo> [--max N]")
	}
	id := args[0]
	spec, ok := algos.Lookup(id)
	if !ok {
		return fmt.Errorf("unknown algorithm %q", id)
	}
	max := 10
	for _, a := range args[1:] {
		if strings.HasPrefix(a, "--max=") {
			max, _ = strconv.Atoi(a[6:])
		}
	}

	// Find the first int input to sweep. Everything else keeps its default.
	var sweep *algos.InputSpec
	for i := range spec.Inputs {
		if spec.Inputs[i].Kind == "int" {
			sweep = &spec.Inputs[i]
			break
		}
	}
	if sweep == nil {
		return fmt.Errorf("%s has no integer input to sweep", id)
	}
	if sweep.Max > 0 && max > sweep.Max {
		max = sweep.Max
	}

	fmt.Printf("%-6s %10s %10s %10s %12s\n", sweep.Name, "events", "steps", "calls", "gen")
	for n := sweep.Min; n <= max; n++ {
		start := time.Now()
		t, err := gen.Generate(id, algos.Args{sweep.Name: n}, 0, 5*time.Second)
		if err != nil {
			return err
		}
		calls := 0
		for i := range t.Events {
			if t.Events[i].T == trace.Call {
				calls++
			}
		}
		note := ""
		if t.Meta.Truncated {
			note = "  (truncated)"
		}
		fmt.Printf("%-6d %10d %10d %10d %12s%s\n",
			n, t.Meta.Counts.Events, t.Meta.Counts.Steps, calls,
			time.Since(start).Round(time.Microsecond), note)
	}
	// A step count that does not grow with n is the smell that an algorithm is
	// missing its cursor structures. FLAWS.md 1 -- this table is the cheapest
	// detector we have for it.
	fmt.Println("\nif steps do not grow with the input, the algorithm is probably missing cursor structures")
	return nil
}
