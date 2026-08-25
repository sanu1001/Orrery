package dp

import (
	_ "embed"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed knapsack.go
var knapSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "knapsack01",
		Title:  "0/1 Knapsack",
		Family: "Dynamic programming",
		Blurb:  "Each row adds one item; each column is a capacity. Take it, or leave it.",
		Inputs: []algos.InputSpec{
			{Name: "weights", Kind: "intList", Max: 8, Default: []int{3, 4, 5, 2},
				Help: "item weights"},
			{Name: "values", Kind: "intList", Max: 8, Default: []int{4, 5, 6, 3},
				Help: "item values (same length as weights)"},
			{Name: "capacity", Kind: "int", Min: 1, Max: 12, Default: 8,
				Help: "knapsack capacity"},
		},
		Defaults: algos.Args{
			"weights": []int{3, 4, 5, 2}, "values": []int{4, 5, 6, 3}, "capacity": 8,
		},
		Source: trace.Source{Path: "internal/algos/dp/knapsack.go", Text: knapSrc, FirstLine: 1},
		Tags:   []string{"grid", "table", "bottom-up"},
		Run:    runKnapsack,
	})
}

func runKnapsack(tr *tracer.Tracer, args algos.Args) error {
	w := args.Ints("weights")
	v := args.Ints("values")
	cap := args.Int("capacity")
	n := len(w)
	if len(v) < n {
		n = len(v)
	}

	rows := make([]string, n+1)
	rows[0] = "-"
	for i := 0; i < n; i++ {
		rows[i+1] = itoa(w[i]) + "kg/" + itoa(v[i])
	}
	cols := make([]string, cap+1)
	for c := 0; c <= cap; c++ {
		cols[c] = itoa(c)
	}

	dp := tr.Grid("dp", n+1, cap+1, 0).Labels(rows, cols)
	tr.View("grid", "dp", 0,
		tracer.Title("value by (items considered, capacity)"),
		tracer.Opt("trail", 6),
		tracer.Opt("answer", []any{n, cap}))

	for i := 1; i <= n; i++ {
		for c := 0; c <= cap; c++ {
			skip := dp.Int(i-1, c)
			if w[i-1] > c {
				dp.Set(i, c, skip).
					Because("dp[%d][%d]", i-1, c).
					From(dp.Cell(i-1, c)).
					Note("item %d weighs %d, which does not fit in %d", i, w[i-1], c)
				continue
			}
			take := dp.Int(i-1, c-w[i-1]) + v[i-1]
			if take > skip {
				dp.Set(i, c, take).
					Because("%d + dp[%d][%d]", v[i-1], i-1, c-w[i-1]).
					From(dp.Cell(i-1, c-w[i-1]), dp.Cell(i-1, c)).
					Note("taking item %d beats skipping it (%d > %d)", i, take, skip)
			} else {
				dp.Set(i, c, skip).
					Because("dp[%d][%d]", i-1, c).
					From(dp.Cell(i-1, c), dp.Cell(i-1, c-w[i-1])).
					Note("skipping item %d is at least as good (%d >= %d)", i, skip, take)
			}
		}
	}
	return tr.Err()
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	if neg {
		return "-" + string(b)
	}
	return string(b)
}
