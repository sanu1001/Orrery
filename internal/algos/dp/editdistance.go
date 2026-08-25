package dp

import (
	_ "embed"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed editdistance.go
var editSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "editdistance",
		Title:  "Edit Distance",
		Family: "Dynamic programming",
		Blurb:  "The fewest insertions, deletions and substitutions that turn one word into another.",
		Inputs: []algos.InputSpec{
			{Name: "a", Kind: "string", Max: 10, Default: "kitten"},
			{Name: "b", Kind: "string", Max: 10, Default: "sitting"},
		},
		Defaults:   algos.Args{"a": "kitten", "b": "sitting"},
		Source:     trace.Source{Path: "internal/algos/dp/editdistance.go", Text: editSrc, FirstLine: 1},
		Tags:       []string{"grid", "table", "three-way"},
		Complexity: "O(n^2)",
		Sweep:      []string{"a", "b"},
		Run:        runEdit,
	})
}

// Three dependencies per cell, which is exactly why this algorithm is in the
// set: it is the one that exercises the explanation template's list rendering.
func runEdit(tr *tracer.Tracer, args algos.Args) error {
	a, b := args.Str("a"), args.Str("b")
	n, m := len(a), len(b)

	rows := make([]string, n+1)
	cols := make([]string, m+1)
	rows[0], cols[0] = "", ""
	for i := 0; i < n; i++ {
		rows[i+1] = string(a[i])
	}
	for j := 0; j < m; j++ {
		cols[j+1] = string(b[j])
	}

	dp := tr.Grid("dp", n+1, m+1, 0).Labels(rows, cols)
	tr.View("grid", "dp", 0,
		tracer.Title("edits"), tracer.Opt("trail", 6),
		tracer.Opt("answer", []any{n, m}))

	for i := 1; i <= n; i++ {
		dp.Set(i, 0, i).Because("delete %d character(s)", i)
	}
	for j := 1; j <= m; j++ {
		dp.Set(0, j, j).Because("insert %d character(s)", j)
	}

	for i := 1; i <= n; i++ {
		for j := 1; j <= m; j++ {
			if a[i-1] == b[j-1] {
				dp.Set(i, j, dp.Int(i-1, j-1)).
					Because("dp[%d][%d]", i-1, j-1).
					From(dp.Cell(i-1, j-1)).
					Note("%c matches %c, so no edit is needed here", a[i-1], b[j-1])
				continue
			}
			del, ins, sub := dp.Int(i-1, j), dp.Int(i, j-1), dp.Int(i-1, j-1)
			best, how := del, "delete"
			if ins < best {
				best, how = ins, "insert"
			}
			if sub < best {
				best, how = sub, "substitute"
			}
			dp.Set(i, j, best+1).
				Because("1 + min(dp[%d][%d], dp[%d][%d], dp[%d][%d])", i-1, j, i, j-1, i-1, j-1).
				From(dp.Cell(i-1, j), dp.Cell(i, j-1), dp.Cell(i-1, j-1)).
				Note("cheapest is to %s", how)
		}
	}
	return tr.Err()
}
