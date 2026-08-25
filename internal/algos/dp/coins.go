package dp

import (
	_ "embed"
	"sort"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed coins.go
var coinsSrc string

// noSolution is the "cannot be made" marker. It renders as an infinity glyph
// rather than a magic number, because a cell reading 1048576 makes the viewer
// hunt for a bug that is not there. TRACE_FORMAT.md 5 explains why infinity
// travels as a string.
const noSolution = 1 << 20

func init() {
	algos.Register(algos.Spec{
		ID:     "coins-memo",
		Title:  "Coin Change (memoized)",
		Family: "Dynamic programming",
		Blurb:  "The fewest coins that make an amount -- as a recursion tree and a memo table, side by side.",
		Inputs: []algos.InputSpec{
			{Name: "coins", Kind: "intList", Max: 6, Default: []int{1, 3, 4},
				Help: "coin denominations"},
			{Name: "amount", Kind: "int", Min: 0, Max: 24, Default: 11},
		},
		Defaults:   algos.Args{"coins": []int{1, 3, 4}, "amount": 11},
		Source:     trace.Source{Path: "internal/algos/dp/coins.go", Text: coinsSrc, FirstLine: 1},
		Tags:       []string{"recursion", "memoization", "flagship"},
		Complexity: "O(n)",
		Sweep:      []string{"amount"},
		Run:        runCoins,
	})
}

// runCoins is THE flagship. Two panes, one store, no synchronization code:
// both panes are pure functions of the same state, so they cannot drift.
//
// The interesting thing to watch is the memo grid's fill ORDER. A bottom-up
// solution fills it left to right; this one jumps around, because the order is
// driven by the recursion rather than by a loop. That scattered trail is the
// entire visual argument for why memoization is not the same as bottom-up DP.
func runCoins(tr *tracer.Tracer, args algos.Args) error {
	coins := append([]int(nil), args.Ints("coins")...)
	// Largest denomination first. The result is identical -- the loop explores
	// every branch regardless of order -- but the recursion tree comes out
	// shallow and bushy instead of one long diagonal, so branching and reuse
	// are visible within the first handful of steps rather than the last.
	sort.Sort(sort.Reverse(sort.IntSlice(coins)))
	amount := args.Int("amount")

	labels := make([]string, amount+1)
	for i := range labels {
		labels[i] = itoa(i)
	}

	memo := tr.Grid("memo", 1, amount+1, nil).Labels([]string{"coins"}, labels)
	tr.View("recursionTree", "$calls", 0,
		tracer.Title("call tree"), tracer.Opt("memoOf", "memo"))
	tr.View("grid", "memo", 1,
		tracer.Title("memo: fewest coins for each amount"),
		tracer.Opt("trail", 8))
	tr.View("callStack", "$calls", "side")

	coinChange(tr, memo, coins, amount)
	return tr.Err()
}

func coinChange(tr *tracer.Tracer, memo *tracer.Grid, coins []int, rem int) int {
	tr.Call("coins", tracer.A("rem", rem))

	if rem == 0 {
		tr.Return(0).Because("nothing left to make")
		return 0
	}
	if rem < 0 {
		// The trace carries the infinity SENTINEL rather than 1<<20. A cell
		// reading 1048576 sends the viewer hunting for a bug that is not there;
		// the Go code keeps its cheap integer while the display stays honest.
		tr.Return(trace.Inf).Because("overshot -- this branch is dead")
		return noSolution
	}
	if v := memo.At(0, rem); v != nil {
		if v == trace.Inf {
			tr.Return(trace.Inf).
				Because("memo[%d]", rem).
				From(memo.Cell(0, rem)).
				Note("already known to be impossible")
			return noSolution
		}
		got := memo.Int(0, rem)
		tr.Return(got).
			Because("memo[%d]", rem).
			From(memo.Cell(0, rem)).
			Note("already solved, so this whole subtree is skipped")
		return got
	}

	best := noSolution
	bestCoin := 0
	for _, c := range coins {
		sub := coinChange(tr, memo, coins, rem-c)
		if sub+1 < best {
			best, bestCoin = sub+1, c
		}
	}

	if best >= noSolution {
		memo.Set(0, rem, trace.Inf).Note("no combination makes %d", rem)
	} else {
		memo.Set(0, rem, best).
			Because("1 + memo[%d]", rem-bestCoin).
			From(memo.Cell(0, rem-bestCoin)).
			Note("best is a %d coin plus the solution for %d", bestCoin, rem-bestCoin)
	}
	if best >= noSolution {
		tr.Return(trace.Inf).Because("no branch leads anywhere")
	} else {
		tr.Return(best).Because("cheapest of the %d branches", len(coins))
	}
	return best
}
