package dp

import (
	_ "embed"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed fib.go
var fibSrc string

func init() {
	src := trace.Source{Path: "internal/algos/dp/fib.go", Text: fibSrc, FirstLine: 1}

	algos.Register(algos.Spec{
		ID:     "fib-naive",
		Title:  "Fibonacci (naive recursion)",
		Family: "Dynamic programming",
		Blurb:  "The same subproblems, over and over. This is what exponential looks like.",
		Inputs: []algos.InputSpec{
			{Name: "n", Kind: "int", Min: 0, Max: 22, Default: 6,
				Help: "try 20 to watch the tree explode"},
		},
		Defaults: algos.Args{"n": 6},
		Source:   src,
		Tags:     []string{"recursion", "exponential"},
		Run:      runFibNaive,
	})

	algos.Register(algos.Spec{
		ID:     "fib-memo",
		Title:  "Fibonacci (memoized)",
		Family: "Dynamic programming",
		Blurb:  "The same recursion, with a table. Watch the tree collapse.",
		Inputs: []algos.InputSpec{
			{Name: "n", Kind: "int", Min: 0, Max: 20, Default: 8},
		},
		Defaults: algos.Args{"n": 8},
		Source:   src,
		Tags:     []string{"recursion", "memoization", "flagship"},
		Run:      runFibMemo,
	})
}

func runFibNaive(tr *tracer.Tracer, args algos.Args) error {
	n := args.Int("n")
	tr.View("recursionTree", "$calls", 0, tracer.Title("call tree"))
	tr.View("callStack", "$calls", "side")
	fibNaive(tr, n)
	return tr.Err()
}

func fibNaive(tr *tracer.Tracer, n int) int {
	tr.Call("fib", tracer.A("n", n))
	if n < 2 {
		tr.Return(n).Because("base case")
		return n
	}
	a := fibNaive(tr, n-1)
	b := fibNaive(tr, n-2)
	tr.Return(a+b).Because("fib(%d) + fib(%d) = %d + %d", n-1, n-2, a, b)
	return a + b
}

// runFibMemo is one half of the flagship. The recursion tree and the memo table
// are the same computation drawn two ways, and the point of showing them side
// by side is that you can SEE which nodes are reused.
//
// Nothing here tells the renderer about memo hits. A memo hit is recognisable
// structurally -- a call with no children whose ret carries deps into the memo
// structure -- so the citation edge is derived, not declared. ADR 0005.
func runFibMemo(tr *tracer.Tracer, args algos.Args) error {
	n := args.Int("n")
	memo := tr.Map("memo", nil)
	tr.View("recursionTree", "$calls", 0,
		tracer.Title("call tree"), tracer.Opt("memoOf", "memo"))
	tr.View("linear", "memo", 1, tracer.Title("memo"))
	tr.View("callStack", "$calls", "side")
	fibMemo(tr, memo, n)
	return tr.Err()
}

func fibMemo(tr *tracer.Tracer, memo *tracer.Map, n int) int {
	tr.Call("fib", tracer.A("n", n))
	key := itoa(n)
	if memo.Has(key) {
		v := memo.Int(key)
		tr.Return(v).
			Because("memo[%d]", n).
			From(memo.Cell(key)).
			Note("already computed, so no work happens here")
		return v
	}
	if n < 2 {
		memo.Set(key, n).Because("base case")
		tr.Return(n).Because("base case")
		return n
	}
	a := fibMemo(tr, memo, n-1)
	b := fibMemo(tr, memo, n-2)
	memo.Set(key, a+b).
		Because("memo[%d] + memo[%d]", n-1, n-2).
		From(memo.Cell(itoa(n-1)), memo.Cell(itoa(n-2)))
	tr.Return(a+b).Because("fib(%d) + fib(%d)", n-1, n-2)
	return a + b
}
