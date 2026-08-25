package backtracking

import (
	_ "embed"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/trace"
	"github.com/sanu1001/orrery/internal/tracer"
)

//go:embed nqueens.go
var nqueensSrc string

func init() {
	algos.Register(algos.Spec{
		ID:     "nqueens",
		Title:  "N-Queens",
		Family: "Backtracking",
		Blurb:  "Place queens column by column, and undo every move that leads nowhere.",
		Inputs: []algos.InputSpec{
			{Name: "n", Kind: "int", Min: 4, Max: 8, Default: 6,
				Help: "board size; 8 produces about 2000 tree nodes"},
			{Name: "all", Kind: "int", Min: 0, Max: 1, Default: 0,
				Help: "0 stops at the first solution, 1 finds them all"},
		},
		Defaults:   algos.Args{"n": 6, "all": 0},
		Source:     trace.Source{Path: "internal/algos/backtracking/nqueens.go", Text: nqueensSrc, FirstLine: 1},
		Tags:       []string{"recursion", "backtracking", "pruning", "board"},
		Complexity: "O(n!)",
		Sweep:      []string{"n"},
		Run:        runNQueens,
	})
}

// N-Queens is the backtracking reference case. The thing to watch is the
// recursion tree: whole subtrees dim to rose as the search abandons them, and
// the live path stays bright. That is what pruning LOOKS like, and it comes out
// of the return value alone -- the renderer classifies a node as failed from
// `ret == false`, with no algorithm-specific code.
//
// Note the input cap of 8 rather than the project-wide "10x10". Trace size is a
// function of COMPLEXITY, not of input size: a 10x10 board has a call tree in
// the hundreds of thousands of nodes. Every algorithm declares its own limits.
// FLAWS.md 3.
func runNQueens(tr *tracer.Tracer, args algos.Args) error {
	n := args.Int("n")
	findAll := args.Int("all") == 1

	board := tr.Grid("board", n, n, 0)
	tr.View("grid", "board", 0,
		tracer.Title("board"),
		tracer.Opt("role", "board"),
		tracer.Opt("glyphs", map[string]any{"1": "Q", "0": ""}))
	tr.View("recursionTree", "$calls", 1,
		tracer.Title("search tree"), tracer.Opt("failWhen", "false"))
	tr.View("callStack", "$calls", "side")

	s := &queens{tr: tr, board: board, n: n, cols: make([]bool, n),
		diag1: make([]bool, 2*n), diag2: make([]bool, 2*n), findAll: findAll}
	s.place(0)
	return tr.Err()
}

type queens struct {
	tr           *tracer.Tracer
	board        *tracer.Grid
	n            int
	cols         []bool
	diag1, diag2 []bool
	solutions    int
	findAll      bool
}

func (q *queens) place(row int) bool {
	q.tr.Call("place", tracer.A("row", row))
	if row == q.n {
		q.solutions++
		q.tr.Return(true).Because("all %d queens are placed", q.n)
		return true
	}
	for col := 0; col < q.n; col++ {
		if !q.safe(row, col) {
			continue
		}
		q.mark(row, col, true)
		q.board.Set(row, col, 1).
			Because("row %d, column %d is not attacked", row, col).
			Note("place a queen at (%d,%d)", row, col)

		if q.place(row+1) && !q.findAll {
			q.tr.Return(true).Because("a solution was found below")
			return true
		}

		q.board.Set(row, col, 0).
			Note("no solution below (%d,%d) -- take the queen back", row, col)
		q.mark(row, col, false)
	}
	q.tr.Return(false).Because("every column in row %d fails", row)
	return false
}

func (q *queens) safe(row, col int) bool {
	return !q.cols[col] && !q.diag1[row+col] && !q.diag2[row-col+q.n]
}

func (q *queens) mark(row, col int, on bool) {
	q.cols[col] = on
	q.diag1[row+col] = on
	q.diag2[row-col+q.n] = on
}
