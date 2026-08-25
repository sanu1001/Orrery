package dp

import (
	_ "embed"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed lcs.go
var lcsSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "lcs",
		Title:  "Longest Common Subsequence",
		Family: "Dynamic programming",
		Blurb:  "Fill a table where every cell asks one question: do these two characters match?",
		Inputs: []algos.InputSpec{
			{Name: "a", Kind: "string", Max: 10, Default: "AGGTAB", Help: "first sequence"},
			{Name: "b", Kind: "string", Max: 10, Default: "GXTXAYB", Help: "second sequence"},
		},
		Defaults: algos.Args{"a": "AGGTAB", "b": "GXTXAYB"},
		Source:   trace.Source{Path: "internal/algos/dp/lcs.go", Text: lcsSrc, FirstLine: 1},
		Tags:     []string{"grid", "table", "bottom-up"},
		Run:      runLCS,
	})
}

func runLCS(tr *tracer.Tracer, args algos.Args) error {
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
		tracer.Title("LCS table"),
		tracer.Opt("trail", 6),
		tracer.Opt("answer", []any{n, m}))

	for i := 1; i <= n; i++ {
		for j := 1; j <= m; j++ {
			if a[i-1] == b[j-1] {
				dp.Set(i, j, dp.Int(i-1, j-1)+1).
					Because("1 + dp[%d][%d]", i-1, j-1).
					From(dp.Cell(i-1, j-1)).
					Note("%c matches %c, so extend the diagonal", a[i-1], b[j-1])
			} else {
				up, left := dp.Int(i-1, j), dp.Int(i, j-1)
				best := up
				if left > best {
					best = left
				}
				dp.Set(i, j, best).
					Because("max(dp[%d][%d], dp[%d][%d])", i-1, j, i, j-1).
					From(dp.Cell(i-1, j), dp.Cell(i, j-1)).
					Note("%c and %c differ, so carry the better neighbour", a[i-1], b[j-1])
			}
		}
	}
	return tr.Err()
}
