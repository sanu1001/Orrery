// Command orrery is the CLI: generate, validate, hash, benchmark and PLAY
// traces from a terminal.
//
// The terminal player is not a toy. It is a second, completely independent
// consumer of the trace format that shares no rendering code with the browser,
// which makes the producer/consumer decoupling something you can demonstrate
// rather than assert. It is also how you debug the tracer without the browser
// in the loop. ENGINE.md 6.
package main

import (
	"fmt"
	"os"

	_ "github.com/sanu1001/orrery/internal/algos/all"
)

const usage = `orrery -- a mechanical model of a running algorithm

usage:
  orrery ls [--ids]                        list registered algorithms
  orrery catalog [-o FILE]                 the algorithm catalogue as JSON
  orrery trace <algo> [flags] [-o FILE]    generate a trace
  orrery verify FILE...                    validate traces (exit 1 on error)
  orrery hash FILE [--all-steps]           state hash, for the conformance suite
  orrery play FILE                         step through a trace in the terminal
  orrery bench <algo> [--max N]            event/step counts vs input size
  orrery complexity [-o file]              measured growth for every algorithm

trace flags are derived from the algorithm's own input spec, e.g.
  orrery trace lcs --a=AGGTAB --b=GXTXAYB
  orrery trace nqueens --n=6
  orrery trace bubble --values=5,2,9,1,7,3
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "ls":
		err = cmdLs(os.Args[2:])
	case "catalog":
		err = cmdCatalog(os.Args[2:])
	case "trace":
		err = cmdTrace(os.Args[2:])
	case "verify":
		err = cmdVerify(os.Args[2:])
	case "hash":
		err = cmdHash(os.Args[2:])
	case "play":
		err = cmdPlay(os.Args[2:])
	case "bench":
		err = cmdBench(os.Args[2:])
	case "complexity":
		err = cmdComplexity(os.Args[2:])
	case "-h", "--help", "help":
		fmt.Print(usage)
		return
	default:
		fmt.Fprintf(os.Stderr, "orrery: unknown command %q\n\n%s", os.Args[1], usage)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "orrery:", err)
		os.Exit(1)
	}
}
